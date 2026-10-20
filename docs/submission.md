# Submission checklist

The implementation follows the assignment supplied in the chat on 20 October 2026. Publishing and final submission require the owner's action because those actions were explicitly reserved for approval.

## Review locally

From this project folder:

```powershell
npm test
npm run test:integration
npm run typecheck
docker compose up --build -d
docker compose logs example
```

Integration tests require the isolated test database described in the README. Successful checks have zero failing tests, healthy API/database containers, and an example container that prints "Demo complete" and exits with code 0.

Read `README.md` and `docs/performance.md`. The JSON results are measurements from this machine, not a promise of deployment throughput.

## Publish to GitHub

Use GitHub's **New repository** page while signed in. Choose a repository name and visibility appropriate for the course, and ensure the assessor can access it. If pushing this existing local repository, create the remote without a README or other initial files.

After reviewing the local commit, run the commands shown by GitHub for pushing an existing repository. For example, replace the URL below with the new repository's actual URL:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/usage-metering-service.git
git push -u origin main
```

Success means GitHub shows the source, SQL files, Docker setup, CLI, tests, README, and performance results. Check that no `.env`, `.local`, `node_modules` or `dist` files appear in the repository. If the repository is private, grant the assessor access according to your course instructions.

## Submit

Open the final-project submission link supplied with your assignment, paste the accessible GitHub repository URL, and complete the form before the end of 20 October 2026. A confirmation from the course's submission system is the completion signal. The service has not been pushed, deployed, or submitted by the coding agent.
