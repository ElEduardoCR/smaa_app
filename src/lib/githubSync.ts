// GitHub commit sync: fetch commits and store them as change_log entries.

export type GitHubCommit = {
    sha: string;
    message: string;
    author: { name: string; email: string; date: string };
    url: string;
};

export type SyncResult = {
    fetched: number;
    inserted: number;
    skipped: number;
    errors: string[];
};

const GH_API = "https://api.github.com";

/**
 * Fetch commits from a GitHub repo. No auth needed for public repos.
 * If token provided, uses it for higher rate limits + private repos.
 */
export async function fetchGitHubCommits(opts: {
    owner: string;
    repo: string;
    branch?: string;
    token?: string | null;
    perPage?: number;
    since?: string; // ISO date
}): Promise<GitHubCommit[]> {
    const params = new URLSearchParams();
    if (opts.branch) params.set("sha", opts.branch);
    if (opts.perPage) params.set("per_page", String(opts.perPage));
    if (opts.since) params.set("since", opts.since);
    const url = `${GH_API}/repos/${opts.owner}/${opts.repo}/commits?${params.toString()}`;

    const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "smaa-erp/1.0",
    };
    if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Respuesta inesperada de GitHub");

    return data.map((c: any) => ({
        sha: c.sha as string,
        message: (c.commit?.message || "").split("\n")[0],
        author: {
            name: c.commit?.author?.name || c.author?.login || "unknown",
            email: c.commit?.author?.email || "",
            date: c.commit?.author?.date || "",
        },
        url: c.html_url,
    }));
}
