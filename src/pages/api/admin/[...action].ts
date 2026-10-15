import type { APIRoute } from 'astro';
import { handleAdminRequest } from '../../../server/admin/service.mjs';
export const prerender = false;
export const ALL: APIRoute = ({ request, clientAddress }) => handleAdminRequest(request, { clientAddress });
