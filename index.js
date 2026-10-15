// -----------------------------------------------------------------------------
// Entry point: wires the Gladys SDK to the Blue Iris hub (src/app.js). No
// device logic here. Handlers are registered before connect().
//
// Environment provided by the Gladys supervisor: GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR (read by the SDK).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, stopping`);
  return app.stop(); // stops the timers and the PTZ moves, ends the session, waits for /data
});

logger.info('Starting the Blue Iris integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
