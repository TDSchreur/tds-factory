/** @import { PrStatus } from './pr-provider.js' */
/** @import { PrLookup } from './run-clean.js' */
/** @import { Project, openProjectRegistry } from './project-registry.js' */
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { openRunStore } from './run-store.js';
import { projectId } from './project-registry.js';
import { createPrViews, ghPrState, ghPrMerge, ghPrStatus, PR_STATUS_REFRESH_MS } from './dashboard-pr-views.js';

/**
 * The PR operations of one Project; what a Project leaves out comes from the server's defaults.
 * @typedef {object} PrSeams
 * @property {(url: string) => Promise<string>} [prState]
 * @property {(url: string, head: string) => Promise<unknown>} [prMerge]
 * @property {PrLookup} [prInfo]
 * @property {(url: string) => Promise<PrStatus>} [prStatus]
 */
/** @typedef {ReturnType<typeof createServices>} ProjectServices */

/** @param {string} dir @param {PrSeams & { statusRefreshMs: number }} seams */
function createServices(
  dir,
  { prState = ghPrState, prMerge = ghPrMerge, prInfo, prStatus = ghPrStatus, statusRefreshMs },
) {
  const store = openRunStore(dir);
  return {
    store,
    // Clean-up must run from the main checkout, also when the Dashboard was started inside a Run worktree.
    mainStore: openRunStore(store.projectDir),
    /** @type {Set<string>} */
    inFlight: new Set(),
    prMerge,
    prInfo,
    statusRefreshMs,
    prViews: createPrViews({ prState, prStatus }),
  };
}

/**
 * The Projects one Dashboard serves: the Project registry, read again on every call so a Project added later appears without a restart, plus the Project the server was started for while the registry does not hold it.
 * Each Project gets its own services (Run stores, in-flight set, PR views and PR seams), made when it is first used.
 * @param {object} options
 * @param {string} options.projectDir
 * @param {ReturnType<typeof openProjectRegistry>} [options.registry] Without one, the server serves only its own Project.
 * @param {PrSeams} [options.defaults]
 * @param {(project: { id: string, path: string }) => PrSeams} [options.prFor]
 * @param {number} [options.statusRefreshMs]
 */
export function createProjectHub({
  projectDir,
  registry,
  defaults = {},
  prFor = () => ({}),
  statusRefreshMs = PR_STATUS_REFRESH_MS,
}) {
  const own = openRunStore(projectDir).projectDir;
  const ownId = projectId(own);
  /** @type {Map<string, ProjectServices>} */
  const services = new Map();
  /** Ids the user removed that this server was started for; they stay gone until the registry holds them again. @type {Set<string>} */
  const removed = new Set();

  /** @returns {Project[]} */
  const known = () => {
    const listed = registry?.list() ?? [];
    if (listed.some((p) => p.id === ownId)) removed.delete(ownId);
    else if (!removed.has(ownId)) listed.push({ id: ownId, path: own });
    return listed;
  };
  // A name shared by two Projects gets its parent folder, so the user can tell them apart.
  /** @param {Project[]} projects */
  const named = (projects) => {
    const count = new Map();
    for (const p of projects) count.set(basename(p.path), (count.get(basename(p.path)) ?? 0) + 1);
    return projects.map((p) => {
      const name = basename(p.path);
      return { ...p, name: count.get(name) > 1 ? `${basename(dirname(p.path))}/${name}` : name };
    });
  };

  const hub = {
    /** Every Project with its name and whether its folder is gone. */
    list: () => named(known()).map((p) => ({ ...p, missing: !existsSync(p.path) })),
    /** @param {string} id */
    find: (id) => hub.list().find((p) => p.id === id),
    /** The services of a Project whose folder exists. @param {{ id: string, path: string }} project */
    servicesOf(project) {
      let made = services.get(project.path);
      if (!made) {
        made = createServices(project.path, { ...defaults, ...prFor(project), statusRefreshMs });
        services.set(project.path, made);
      }
      return made;
    },
    /** Removes a Project the registry holds. @param {string} id */
    async remove(id) {
      const activeRegistry = registry;
      if (!activeRegistry) return id === ownId ? 'own-not-registered' : 'not-found';
      const project = activeRegistry.list().find((p) => p.id === id);
      if (!project) return id === ownId ? 'own-not-registered' : 'not-found';
      const removedById = await activeRegistry.removeAsync(id);
      if (!removedById) return 'not-found';
      services.delete(project.path);
      if (id === ownId) removed.add(id);
      return 'removed';
    },
    /** Removes every missing Project from the registry and returns how many were removed. */
    async removeMissing() {
      const activeRegistry = registry;
      if (!activeRegistry) return 0;
      const removedPaths = await activeRegistry.removeMissingAsync();
      for (const gone of removedPaths) services.delete(gone);
      if (removedPaths.includes(own)) removed.add(ownId);
      return removedPaths.length;
    },
    /** True when a registry backs this server, so it serves every registered Project. */
    shared: registry !== undefined,
    projectId: ownId,
    projectDir: own,
  };
  return hub;
}
