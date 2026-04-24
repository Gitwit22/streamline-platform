/**
 * Program/Lane configuration types.
 *
 * A "program" represents a distinct StreamLine deployment lane (e.g. EDU or Corporate).
 * The active program is resolved from VITE_STREAMLINE_PROGRAM at build time.
 */

export type ProgramKey = "edu" | "corporate";

/**
 * Feature flags that vary by program/lane.
 * Use these to show or hide features without scattering env reads throughout the app.
 */
export type ProgramFeatureFlags = {
  /** School classrooms, class sessions, class management */
  canUseClassrooms: boolean;
  /** Course catalog and course-based learning paths */
  canUseCourses: boolean;
  /** Corporate departments / org-units */
  canUseDepartments: boolean;
  /** Corporate-specific room types and training rooms */
  canUseCorporateRooms: boolean;
  /** Team workspaces (corporate) */
  canUseTeams: boolean;
  /** Live broadcast / webinar streaming */
  canUseWebinars: boolean;
  /** Green room / backstage pre-show feature */
  canUseGreenroom: boolean;
  /** Intro clip recorder */
  canUseIntroClip: boolean;
  /** Recordings / media library */
  canUseRecordingLibrary: boolean;
  /** Pay-per-view event ticketing */
  canUsePayPerView: boolean;
  /** Admin usage analytics dashboard */
  canUseAdminUsage: boolean;
  /** Support hub / help desk integration */
  canUseSupportHub: boolean;
  /** Room customization / branding controls */
  canCustomizeRooms: boolean;
};

/**
 * Full program configuration resolved for the active deployment lane.
 */
export type ProgramConfig = {
  /** The canonical key for this program, e.g. "edu" or "corporate". */
  programKey: ProgramKey;

  /**
   * The public domain identifier sent to the backend via x-program-domain.
   * Used for backend routing/scoping convenience — not a security boundary.
   */
  programDomain: string;

  /** Full product name, e.g. "StreamLine EDU". */
  appName: string;

  /** Short product identifier shown in compact UI areas, e.g. "EDU". */
  shortName: string;

  /** Marketing tagline for landing pages and empty states. */
  tagline: string;

  /** Route to redirect to after a successful login. */
  defaultRouteAfterLogin: string;

  /** The root public landing/marketing route for this program. */
  publicLandingRoute: string;

  /**
   * Nav item IDs that are enabled for this program.
   * Used by sidebars to hide items not applicable to this lane.
   */
  enabledRoutes: readonly string[];

  /** Feature flags controlling which capabilities are active for this program. */
  features: ProgramFeatureFlags;

  /** Optional: identifier used when communicating with the Support Hub service. */
  supportHubProgramId?: string;

  /** Optional: billing product key / plan namespace for this program. */
  billingProductKey?: string;

  /**
   * Value sent in the x-program-domain request header.
   * Mirrors programDomain — kept explicit for clarity at the call site.
   */
  backendProgramHeader: string;
};
