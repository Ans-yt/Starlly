import { Router, type RequestHandler } from "express";
/** Express 4 does not forward rejected route promises. */
export function asyncRouter(): Router {
  const router = Router();
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = router[method].bind(router) as (...args: any[]) => Router;
    router[method] = ((route: unknown, ...handlers: RequestHandler[]) =>
      original(
        route,
        ...handlers.flat().map(
          (handler) =>
            ((req, res, next) => {
              try {
                Promise.resolve(handler(req, res, next)).catch(next);
              } catch (err) {
                next(err);
              }
            }) as RequestHandler,
        ),
      )) as (typeof router)[typeof method];
  }
  return router;
}
