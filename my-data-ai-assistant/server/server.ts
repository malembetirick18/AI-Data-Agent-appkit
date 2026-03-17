import { createApp, genie, server } from '@databricks/appkit';

const genieSpaceId = process.env.DATABRICKS_GENIE_SPACE_ID;

createApp({
  plugins: [
    server(),
    genie(
      genieSpaceId
        ? {
            spaces: {
              demo: genieSpaceId,
            },
          }
        : {},
    ),
  ],
}).then(async () => {
}).catch((error) => {
  console.error('Failed to start AppKit server:', error);
});
