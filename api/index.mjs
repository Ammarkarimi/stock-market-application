// Vercel serves every /api request with this function (see vercel.json); `npm run build` compiles the server first.
// The market loads and its background work starts on the first request each instance handles.
import { createApp } from '../server/dist/app.js';

export default createApp();
