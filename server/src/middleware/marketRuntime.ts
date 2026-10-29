import type { NextFunction, Request, Response } from 'express';
import { prepareServer, scheduleDueWork, syncMarketState } from '../market/runtime.js';

/** Makes sure the market is loaded and current before a request, and starts any background work that is due. */
export async function marketRuntime(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  await prepareServer();
  await syncMarketState();
  scheduleDueWork();
  next();
}
