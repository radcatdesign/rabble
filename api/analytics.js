/* One function for all of analytics (collect, presence, dashboard data, the daily job), routed by /api/analytics/:op */
import { handle } from '../server/analytics.js';

export const GET = request => handle(request, process.env);
export const POST = request => handle(request, process.env);
