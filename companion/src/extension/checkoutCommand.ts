import { normalizeRemote, type CheckoutCommand } from '../protocol';

export interface NamedRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

/** Name of the remote that points at `repo` (`owner/repo`), or null. */
export function findRemote(remotes: readonly NamedRemote[], repo: string): string | null {
  const target = `github.com/${repo}`.toLowerCase();
  const remote = remotes.find(
    (candidate) =>
      /^[\w.-]+$/.test(candidate.name) &&
      normalizeRemote(candidate.fetchUrl ?? candidate.pushUrl ?? '') === target,
  );
  return remote?.name ?? null;
}

/**
 * Shell command typed into the integrated terminal. Callers validate branch,
 * repo, and remote names first, so single quotes are enough for any shell.
 */
export function checkoutShellCommand(
  command: CheckoutCommand,
  local: { remote: string | null; branchExists: boolean },
): string {
  if (command.fork) {
    return `gh pr checkout ${command.pullNumber} --repo ${quote(command.repo)}`;
  }
  if (!local.remote) {
    throw new Error(`No remote points at ${command.repo}.`);
  }
  const remote = quote(local.remote);
  const branch = quote(command.branch);
  const fetch = `git fetch ${remote} ${branch}`;
  return local.branchExists
    ? `${fetch} && git switch ${branch}`
    : `${fetch} && git switch -c ${branch} --track ${quote(`${local.remote}/${command.branch}`)}`;
}

function quote(value: string): string {
  if (value.includes("'")) {
    throw new Error(`Refusing to quote ${JSON.stringify(value)}.`);
  }
  return `'${value}'`;
}
