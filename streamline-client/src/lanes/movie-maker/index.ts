/**
 * Movie Maker Lane — public API barrel.
 *
 * Everything the rest of the app needs to consume from the Movie Maker lane
 * should be re-exported here.
 */
export { movieMakerRoutes } from "./routes";
export type { MovieMakerRouteFlags } from "./routes";
export { movieMakerNavItems } from "./nav";
