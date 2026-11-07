import { FeedbackService } from '../../src/application/services/feedback.service.js';
import { PostIngestor } from '../../src/application/services/post-ingestor.js';
import { GithubIssueTracker } from '../../src/infrastructure/github/github-issue-tracker.js';
import type { PostSyncPlan } from '../../src/core/feedback/types.js';
import type { Env } from './env.js';
import { csvList } from './env.js';
import { logger } from './logger.js';
import { DiscordRest } from './discord-rest.js';
import { D1FeedbackStore } from './store-d1.js';
import { WorkerBacklogNotifier } from './notifier.js';
import { WorkerForumSource } from './forum-source.js';

export interface WorkerServices {
  rest: DiscordRest;
  store: D1FeedbackStore;
  service: FeedbackService;
  ingestor: PostIngestor | null;
  plans: PostSyncPlan[];
}

/** Composition root del worker: misma logica de aplicacion que la version local. */
export function buildServices(env: Env): WorkerServices {
  const rest = new DiscordRest(env.DISCORD_TOKEN);
  const store = new D1FeedbackStore(env.D1);
  const tracker = new GithubIssueTracker(
    {
      token: env.DEVBOT_GITHUB_TOKEN,
      repo: env.DEVBOT_GITHUB_REPO,
      bugLabels: csvList(env.DEVBOT_BUG_LABELS),
      suggestionLabels: csvList(env.DEVBOT_SUGGESTION_LABELS),
    },
    logger,
  );
  const notifier = new WorkerBacklogNotifier(rest, env, logger);
  const service = new FeedbackService(tracker, store, notifier, logger);

  const plans: PostSyncPlan[] = [];
  if (env.DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID) {
    plans.push({
      kind: 'suggestion',
      channelId: env.DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID,
      requiredTag: env.DEVBOT_PROPOSALS_REQUIRED_TAG,
      doneTag: env.DEVBOT_PROPOSALS_DONE_TAG || null,
    });
  }
  if (env.DEVBOT_FEEDBACK_BUGS_CHANNEL_ID) {
    plans.push({
      kind: 'bug',
      channelId: env.DEVBOT_FEEDBACK_BUGS_CHANNEL_ID,
      requiredTag: env.DEVBOT_BUGS_REQUIRED_TAG,
      doneTag: env.DEVBOT_BUGS_DONE_TAG || null,
    });
  }

  const forumSource = new WorkerForumSource(rest, env, logger);
  const ingestor = plans.length > 0 ? new PostIngestor(forumSource, tracker, store, logger) : null;

  return { rest, store, service, ingestor, plans };
}
