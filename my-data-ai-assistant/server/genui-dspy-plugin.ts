import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Plugin, toPlugin, type BasePluginConfig, type PluginManifest, ResourceType } from '@databricks/appkit';
import express, { type Router } from 'express';
import { chatUiCatalog } from '../shared/genui-catalog';
import {
  clearSupervisorApprovalCookie,
  issueSupervisorApproval,
  setSupervisorApprovalCookie,
} from './supervisor-approval-store';

interface GenUiDspyPluginConfig extends BasePluginConfig {
  pythonExecutable?: string;
  runnerScriptPath?: string;
  timeoutMs?: number;
}

interface GenerateSpecRequest {
  prompt: string;
  genieResult?: unknown;
  systemPrompt?: string;
}

interface SupervisorQuestionOption {
  value: string;
  label: string;
}

interface SupervisorQuestion {
  id: string;
  label: string;
  inputType?: 'select' | 'text';
  required?: boolean;
  placeholder?: string;
  options?: SupervisorQuestionOption[];
}

interface SupervisorRequest {
  prompt: string;
  conversationContext?: unknown;
  genieCatalog?: unknown;
}

interface GenerateSpecResponse {
  spec: unknown;
  traceId?: string;
  model?: string;
}

function buildServerFallbackSpec(prompt: string): GenerateSpecResponse {
  const safePrompt = prompt.slice(0, 240);
  return {
    spec: {
      root: 'root',
      elements: {
        root: {
          type: 'Stack',
          props: { gap: 6 },
          children: ['text-1'],
        },
        'text-1': {
          type: 'TextContent',
          props: {
            content: `Generation indisponible. Prompt reçu: ${safePrompt}`,
            size: 'sm',
          },
          children: [],
        },
      },
    },
    model: 'server-fallback',
  };
}

interface SupervisorResponse {
  decision: 'clarify' | 'guide' | 'proceed' | 'error';
  message: string;
  rewrittenPrompt?: string;
  suggestedTables?: string[];
  suggestedFunctions?: string[];
  questions?: SupervisorQuestion[];
  confidence?: number;
  traceId?: string;
  model?: string;
  catalogSource?: 'payload' | 'env-json' | 'env-file' | 'empty';
}

function isSupervisorApproved(decision: SupervisorResponse['decision'], confidence?: number): boolean {
  return decision === 'proceed' && typeof confidence === 'number' && confidence >= 0.90;
}

const pythonDepsReadyByExecutable = new Map<string, boolean>();
const DEFAULT_KNOWLEDGE_STORE_PATH = resolve(process.cwd(), 'catalog_schemas_description', 'genie_knowledge_store.json');

let knowledgeStoreCache:
  | {
      sourcePath: string;
      mtimeMs: number;
      payload: unknown;
    }
  | undefined;

const manifest = {
  name: 'genUiDspy',
  displayName: 'GenUI DSPy Plugin',
  description: 'Generates JSON-Render specs from Genie outputs using local DSPy with MLflow tracing.',
  resources: {
    required: [],
    optional: [
      {
        type: ResourceType.SECRET,
        alias: 'llmApiKey',
        resourceKey: 'llmApiKey',
        description: 'Optional secret used by your custom LLM backend.',
        permission: 'READ',
        fields: {
          scope: { env: 'GENUI_SECRET_SCOPE', description: 'Databricks secret scope containing LLM credential.' },
          key: { env: 'GENUI_SECRET_KEY', description: 'Databricks secret key containing LLM credential.' },
        },
      },
    ],
  },
} satisfies PluginManifest<'genUiDspy'>;

class GenUiDspyPlugin extends Plugin<GenUiDspyPluginConfig> {
  static manifest = manifest;

  private async runPythonCommand(params: {
    pythonExecutable: string;
    args: string[];
    timeoutMs: number;
    errorPrefix: string;
  }): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
    const { pythonExecutable, args, timeoutMs, errorPrefix } = params;

    return await new Promise((resolveResult) => {
      const child = spawn(pythonExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        console.error(errorPrefix, error);
        resolveResult({ ok: false, code: null, stdout, stderr });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolveResult({ ok: code === 0, code, stdout, stderr });
      });
    });
  }

  injectRoutes(router: Router): void {
    // Route-level body parser with 5 MB limit.
    // The global AppKit parser (100 kb) is bypassed via skipBodyParsing below.
    router.use('/spec', express.json({ limit: '5mb' }));
    router.use('/supervisor', express.json({ limit: '5mb' }));

    this.route(router, {
      name: 'generate-spec',
      method: 'post',
      path: '/spec',
      skipBodyParsing: true,
      handler: async (req, res) => {
        const body = req.body as GenerateSpecRequest;
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

        if (!prompt) {
          res.status(400).json({ error: 'prompt is required' });
          return;
        }

        const generated = await this.runDspyGeneration({
          prompt,
          genieResult: body.genieResult,
          systemPrompt: chatUiCatalog.prompt(),
        });

        if (!generated) {
          res.status(200).json(buildServerFallbackSpec(prompt));
          return;
        }

        res.status(200).json(generated);
      },
    });

    this.route(router, {
      name: 'supervisor-preflight',
      method: 'post',
      path: '/supervisor',
      skipBodyParsing: true,
      handler: async (req, res) => {
        const body = req.body as SupervisorRequest;
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

        if (!prompt) {
          res.status(400).json({ error: 'prompt is required' });
          return;
        }

        const supervised = await this.runSupervisorAnalysis({
          prompt,
          conversationContext: body.conversationContext,
          genieCatalog: this.resolveSupervisorCatalog(body.genieCatalog),
        });

        if (!supervised) {
          clearSupervisorApprovalCookie(res);
          res.status(502).json({
            decision: 'error',
            message: 'Supervisor analysis failed',
          } satisfies SupervisorResponse);
          return;
        }

        if (isSupervisorApproved(supervised.decision, supervised.confidence) || supervised.decision === 'guide') {
          const approvedPrompt = supervised.rewrittenPrompt?.trim() || prompt;
          const approvalToken = issueSupervisorApproval({
            approvedPrompt,
            traceId: supervised.traceId,
          });
          setSupervisorApprovalCookie(res, approvalToken);
        } else {
          clearSupervisorApprovalCookie(res);
        }

        res.status(200).json(supervised);
      },
    });
  }

  private async ensurePythonDependencies(pythonExecutable: string, timeoutMs: number): Promise<boolean> {
    const skipDependencyCheck = process.env.GENUI_SKIP_PYTHON_DEPS_CHECK === 'true';
    const autoInstallDeps = process.env.GENUI_AUTO_INSTALL_PYTHON_DEPS === 'true';
    const requirementsPath = process.env.GENUI_DSPY_REQUIREMENTS_PATH || resolve(process.cwd(), 'server', 'python', 'requirements-dspy.txt');

    if (skipDependencyCheck) {
      return true;
    }

    if (pythonDepsReadyByExecutable.get(pythonExecutable)) {
      return true;
    }

    const checkScript = [
      'import importlib.util, sys',
      "required = ['dspy', 'mlflow']",
      'missing = [pkg for pkg in required if importlib.util.find_spec(pkg) is None]',
      'if missing:',
      "    print('Missing Python packages: ' + ', '.join(missing), file=sys.stderr)",
      '    sys.exit(2)',
      'print("ok")',
      ].join('\n');

    const runPreflight = async (): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> => {
      return await this.runPythonCommand({
        pythonExecutable,
        args: ['-c', checkScript],
        timeoutMs: Math.min(timeoutMs, 15000),
        errorPrefix: '[genUiDspy] Failed to run Python dependency preflight:',
      });
    };

    const firstCheck = await runPreflight();
    if (firstCheck.ok) {
      pythonDepsReadyByExecutable.set(pythonExecutable, true);
      return true;
    }

    if (autoInstallDeps) {
      const installResult = await this.runPythonCommand({
        pythonExecutable,
        args: ['-m', 'pip', 'install', '-r', requirementsPath],
        timeoutMs: Math.max(timeoutMs, 120000),
        errorPrefix: '[genUiDspy] Failed to auto-install Python dependencies:',
      });

      if (!installResult.ok) {
        console.error('[genUiDspy] Auto-install failed.', {
          pythonExecutable,
          requirementsPath,
          code: installResult.code,
          stderr: installResult.stderr.slice(0, 3000),
        });
      } else {
        const secondCheck = await runPreflight();
        if (secondCheck.ok) {
          pythonDepsReadyByExecutable.set(pythonExecutable, true);
          return true;
        }
      }
    }

    console.error('[genUiDspy] Python dependency preflight failed. Install requirements with `python -m pip install -r server/python/requirements-dspy.txt`.', {
      pythonExecutable,
      requirementsPath,
      code: firstCheck.code,
      stderr: firstCheck.stderr.slice(0, 3000),
    });
    return false;
  }

  private async runDspyGeneration(payload: GenerateSpecRequest): Promise<GenerateSpecResponse | undefined> {
    const pythonExecutable = this.config.pythonExecutable || process.env.GENUI_PYTHON_EXECUTABLE || 'python';
    const runnerScriptPath =
      this.config.runnerScriptPath ||
      process.env.GENUI_DSPY_RUNNER_PATH ||
      resolve(process.cwd(), 'server', 'python', 'dspy_genui_runner.py');
    const timeoutMs = this.config.timeoutMs || Number(process.env.GENUI_DSPY_TIMEOUT_MS || 60000);

    const depsReady = await this.ensurePythonDependencies(pythonExecutable, timeoutMs);
    if (!depsReady) {
      return undefined;
    }

    return await this.runJsonPythonRunner<GenerateSpecResponse>({
      pythonExecutable,
      runnerScriptPath,
      timeoutMs,
      payload,
      validator: (parsed) => Boolean(parsed && typeof parsed === 'object' && 'spec' in parsed),
      invalidMessage: '[genUiDspy] Invalid runner output payload',
      errorPrefix: '[genUiDspy] Failed to start DSPy runner:',
      exitPrefix: '[genUiDspy] DSPy runner exited with error:',
      parsePrefix: '[genUiDspy] Failed to parse runner output:',
    });
  }

  private async runSupervisorAnalysis(payload: SupervisorRequest): Promise<SupervisorResponse | undefined> {
    const pythonExecutable = this.config.pythonExecutable || process.env.GENUI_PYTHON_EXECUTABLE || 'python';
    const runnerScriptPath =
      process.env.GENUI_SUPERVISOR_RUNNER_PATH ||
      resolve(process.cwd(), 'server', 'python', 'dspy_supervisor_runner.py');
    const timeoutMs = Number(process.env.GENUI_SUPERVISOR_TIMEOUT_MS || this.config.timeoutMs || 45000);

    const depsReady = await this.ensurePythonDependencies(pythonExecutable, timeoutMs);
    if (!depsReady) {
      return undefined;
    }

    return await this.runJsonPythonRunner<SupervisorResponse>({
      pythonExecutable,
      runnerScriptPath,
      timeoutMs,
      payload,
      validator: (parsed) => Boolean(parsed && typeof parsed === 'object' && 'decision' in parsed && 'message' in parsed),
      invalidMessage: '[genUiDspy] Invalid supervisor payload',
      errorPrefix: '[genUiDspy] Failed to start supervisor runner:',
      exitPrefix: '[genUiDspy] Supervisor runner exited with error:',
      parsePrefix: '[genUiDspy] Failed to parse supervisor output:',
    });
  }

  private resolveSupervisorCatalog(requestCatalog?: unknown): unknown {
    const envJson = process.env.GENIE_KNOWLEDGE_STORE_JSON;
    if (envJson) {
      try {
        const parsedCatalog = JSON.parse(envJson) as unknown;
        return {
          source: 'env-json',
          catalog: parsedCatalog,
        };
      } catch (error) {
        console.error('[genUiDspy] Failed to parse GENIE_KNOWLEDGE_STORE_JSON:', error);
      }
    }

    const configuredPath = process.env.GENIE_KNOWLEDGE_STORE_PATH || DEFAULT_KNOWLEDGE_STORE_PATH;
    const fileCatalog = this.readKnowledgeStoreFromFile(configuredPath);
    if (fileCatalog) {
      return fileCatalog;
    }

    if (requestCatalog && typeof requestCatalog === 'object') {
      return {
        source: 'payload',
        catalog: requestCatalog,
      };
    }

    return {
      source: 'empty',
      catalog: {
        tables: [],
        functions: [],
      },
    };
  }

  private readKnowledgeStoreFromFile(filePath: string): { source: 'env-file'; catalog: unknown } | undefined {
    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      const fileStats = statSync(filePath);
      if (
        knowledgeStoreCache &&
        knowledgeStoreCache.sourcePath === filePath &&
        knowledgeStoreCache.mtimeMs === fileStats.mtimeMs
      ) {
        return {
          source: 'env-file',
          catalog: knowledgeStoreCache.payload,
        };
      }

      const parsedCatalog = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
      knowledgeStoreCache = {
        sourcePath: filePath,
        mtimeMs: fileStats.mtimeMs,
        payload: parsedCatalog,
      };

      return {
        source: 'env-file',
        catalog: parsedCatalog,
      };
    } catch (error) {
      console.error('[genUiDspy] Failed to read knowledge store file:', { filePath, error });
      return undefined;
    }
  }

  private async runJsonPythonRunner<T>(params: {
    pythonExecutable: string;
    runnerScriptPath: string;
    timeoutMs: number;
    payload: unknown;
    validator: (parsed: unknown) => boolean;
    invalidMessage: string;
    errorPrefix: string;
    exitPrefix: string;
    parsePrefix: string;
  }): Promise<T | undefined> {
    const {
      pythonExecutable,
      runnerScriptPath,
      timeoutMs,
      payload,
      validator,
      invalidMessage,
      errorPrefix,
      exitPrefix,
      parsePrefix: _parsePrefix,
    } = params;

    return await new Promise<T | undefined>((resolvePromise) => {
      const child = spawn(pythonExecutable, [runnerScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        console.error(errorPrefix, error);
        resolvePromise(undefined);
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        // Always attempt to parse stdout — the Python script may output valid
        // JSON (e.g. a decision:'error' response) even on non-zero exit codes.
        if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout) as T;
            if (validator(parsed)) {
              if (code !== 0) {
                console.warn(exitPrefix, { code, note: 'recovered valid JSON from stdout' });
              }
              resolvePromise(parsed);
              return;
            }
          } catch {
            // stdout is not valid JSON — fall through to error path
          }
        }

        if (code !== 0) {
          console.error(exitPrefix, { code, stderr: stderr.slice(0, 4000) });
          resolvePromise(undefined);
          return;
        }

        // code === 0 but stdout was empty or invalid
        console.error(invalidMessage, stdout.slice(0, 4000));
        resolvePromise(undefined);
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}

export const genUiDspy = toPlugin(GenUiDspyPlugin);
export type {
  GenUiDspyPluginConfig,
  GenerateSpecRequest,
  GenerateSpecResponse,
  SupervisorQuestion,
  SupervisorQuestionOption,
  SupervisorRequest,
  SupervisorResponse,
};
