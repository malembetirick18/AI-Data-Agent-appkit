import logging


class Logger:
    def __init__(
        self,
        name: str        = "semantic-layer-api",
        level: int       = logging.INFO,
        log_file         = None,
        fmt: str         = "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt: str     = "%Y-%m-%d %H:%M:%S",
    ):
        self.logger = logging.getLogger(name)
        if self.logger.handlers:
            return  # already configured — singleton guard (same name → same instance)

        self.logger.setLevel(level)
        formatter = logging.Formatter(fmt=fmt, datefmt=datefmt)

        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        self.logger.addHandler(stream_handler)

        if log_file:
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)

    def child(self, suffix: str) -> "Logger":
        """Return a namespaced child Logger — '{parent_name}.{suffix}'.

        Uses __new__ to bypass __init__ so no extra handlers are attached.
        Python's logging hierarchy propagates records up to the root handler
        automatically (propagate=True by default), so the parent's StreamHandler
        handles all output with no duplication.

        Usage:
            root   = Logger("semantic-layer-api")           # sets up handlers once
            ctrl   = root.child("controller")               # semantic-layer-api.controller
            genui  = root.child("genui")                    # semantic-layer-api.genui
        """
        obj = Logger.__new__(Logger)
        obj.logger = logging.getLogger(f"{self.logger.name}.{suffix}")
        return obj

    # Convenience forwarding methods
    def debug(self, *args, **kwargs):   self.logger.debug(*args, **kwargs)
    def info(self, *args, **kwargs):    self.logger.info(*args, **kwargs)
    def warning(self, *args, **kwargs): self.logger.warning(*args, **kwargs)
    def error(self, *args, **kwargs):   self.logger.error(*args, **kwargs)
    def critical(self, *a, **kw):       self.logger.critical(*a, **kw)

    @property
    def raw(self) -> logging.Logger:    return self.logger
