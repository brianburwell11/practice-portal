/**
 * Public surface of the API core. Adapters import from here.
 */
export { HttpError, json, ok } from './http';
export { matchRoute, runRoute, type RouteMatch } from './router';
export { routes } from './routes';
export type {
  CoreHandler,
  CoreRequest,
  CoreResponse,
  HttpMethod,
  RouteDef,
  UploadedFile,
} from './types';
