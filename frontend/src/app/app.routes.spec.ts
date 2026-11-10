import { routes } from './app.routes';
import { JobPage } from './pages/job';
import { JobsPage } from './pages/jobs';

describe('routes', () => {
  const load = (path: string) => (routes.find((r) => r.path === path)!.loadComponent as () => Promise<unknown>)();

  it('opens the jobs list on /jobs and one job on /jobs/:key', async () => {
    expect(await load('jobs')).toBe(JobsPage);
    expect(await load('jobs/:key')).toBe(JobPage);
  });
});
