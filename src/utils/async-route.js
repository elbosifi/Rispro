export function asyncRoute(handler) {
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
