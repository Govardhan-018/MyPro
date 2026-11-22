import type { CapabilityMeta } from './capability.types';

/**
 * Routing metadata for every skill in `skills/definitions.ts`.
 *
 * Keyed by skill name. A skill with no entry here still works — it gets a
 * derived fallback (category 'other', keywords from its own name) and is only
 * offered when the router has room — but `capability-registry.test.ts` fails
 * until it is listed, which is how a new skill gets routed instead of
 * quietly becoming unreachable.
 *
 * Keywords are the request vocabulary, not documentation. Think "what words
 * would be in the sentence that needs this?".
 */
const meta = (m: CapabilityMeta): CapabilityMeta => m;

export const CAPABILITY_META: Readonly<Record<string, CapabilityMeta>> = {
  /* ---- time: always on, it is one line of output ---- */
  get_now: meta({
    name: 'get_now',
    version: '1.0.0',
    category: 'time',
    keywords: ['today', 'now', 'tomorrow', 'tonight', 'this week', 'date', 'time', 'weekend'],
    always: true,
    enabled: true,
  }),

  /* ---- calendar ---- */
  list_events: meta({
    name: 'list_events',
    version: '1.0.0',
    category: 'calendar',
    keywords: ['calendar', 'calender', 'schedule', 'event', 'events', 'booked', 'busy',
      'free', 'meeting', 'appointment', 'diary', 'agenda', 'clash', 'conflict',
      'already have'],
    dependencies: ['get_now'],
    enabled: true,
  }),
  create_event: meta({
    name: 'create_event',
    version: '1.0.0',
    category: 'calendar',
    // 'add to my calendar' alone missed "add THEM to my calendar", which is
    // exactly how a person phrases it after asking for a list of things.
    // 'calender' is here on purpose: it is the common misspelling, and a
    // capability the router cannot reach is one the agent will claim not to
    // have. The lie guard in capability.routing.ts is the real backstop.
    keywords: ['calendar', 'calender', 'add to my calendar', 'to my calendar',
      'in my calendar', 'to the calendar', 'add them', 'add it', 'add these', 'book',
      'schedule', 'put in', 'put them', 'block out', 'event', 'meeting', 'appointment',
      'reminder', 'remind me', 'remind me at', 'pencil in'],
    dependencies: ['get_now', 'list_events'],
    enabled: true,
  }),
  update_event: meta({
    name: 'update_event',
    version: '1.0.0',
    category: 'calendar',
    keywords: ['move', 'reschedule', 'change the time', 'push back', 'bring forward', 'rename'],
    dependencies: ['list_events'],
    enabled: true,
  }),
  delete_event: meta({
    name: 'delete_event',
    version: '1.0.0',
    category: 'calendar',
    keywords: ['cancel', 'delete', 'remove', 'drop', 'call off'],
    dependencies: ['list_events'],
    enabled: true,
  }),

  /* ---- tasks ---- */
  list_tasks: meta({
    name: 'list_tasks',
    version: '1.0.0',
    category: 'tasks',
    keywords: ['task', 'tasks', 'to-do', 'todo', 'to do', 'what do i need', 'outstanding',
      'open items', 'list', 'chores'],
    enabled: true,
  }),
  create_task: meta({
    name: 'create_task',
    version: '1.0.0',
    category: 'tasks',
    keywords: ['add a task', 'remind me to', 'note down', 'i need to', 'make a task', 'todo'],
    enabled: true,
  }),
  update_task: meta({
    name: 'update_task',
    version: '1.0.0',
    category: 'tasks',
    keywords: ['done', 'finished', 'completed', 'tick off', 'mark', 'did it', 'reschedule task'],
    dependencies: ['list_tasks'],
    enabled: true,
  }),

  /* ---- commitments: promises with a state machine ---- */
  list_commitments: meta({
    name: 'list_commitments',
    version: '1.0.0',
    category: 'commitments',
    keywords: ['commitment', 'commitments', 'promised', 'owe', 'i said i would', 'deadline',
      'at risk', 'slipping', 'on the hook'],
    enabled: true,
  }),
  create_commitment: meta({
    name: 'create_commitment',
    version: '1.0.0',
    category: 'commitments',
    keywords: ['i promised', 'i will', 'commit to', 'by friday', 'hold me to', 'deadline'],
    enabled: true,
  }),
  update_commitment: meta({
    name: 'update_commitment',
    version: '1.0.0',
    category: 'commitments',
    keywords: ['done', 'delivered', 'slipped', 'abandoned', 'gave up', 'finished it'],
    dependencies: ['list_commitments'],
    enabled: true,
  }),

  /* ---- memory ---- */
  remember: meta({
    name: 'remember',
    version: '1.0.0',
    category: 'memory',
    keywords: ['remember', 'my favourite', 'my favorite', 'i prefer', 'i like', 'i hate',
      'note that', 'keep in mind', 'for future reference', 'i support', 'i follow'],
    enabled: true,
  }),
  forget: meta({
    name: 'forget',
    version: '1.0.0',
    category: 'memory',
    keywords: ['forget', 'stop remembering', 'that is wrong', 'no longer', 'drop that'],
    enabled: true,
  }),
  open_thread: meta({
    name: 'open_thread',
    version: '1.0.0',
    category: 'memory',
    keywords: ['worried about', 'working on', 'going on with', 'keep an eye on', 'ongoing',
      'thread', 'situation'],
    enabled: true,
  }),
  close_thread: meta({
    name: 'close_thread',
    version: '1.0.0',
    category: 'memory',
    keywords: ['sorted', 'resolved', 'over', 'behind me', 'close that off'],
    dependencies: ['open_thread'],
    enabled: true,
  }),

  /* ---- library and notes ---- */
  search_library: meta({
    name: 'search_library',
    version: '1.0.0',
    category: 'library',
    keywords: ['book', 'books', 'reading', 'read', 'podcast', 'episode', 'library', 'author',
      'chapter', 'listening'],
    enabled: true,
  }),
  add_library_item: meta({
    name: 'add_library_item',
    version: '1.0.0',
    category: 'library',
    keywords: ['add to my library', 'want to read', 'reading list', 'add this book', 'queue up'],
    enabled: true,
  }),
  update_reading_progress: meta({
    name: 'update_reading_progress',
    version: '1.0.0',
    category: 'library',
    keywords: ['progress', 'page', 'percent', 'finished the book', 'halfway through'],
    dependencies: ['search_library'],
    enabled: true,
  }),
  search_knowledge: meta({
    name: 'search_knowledge',
    version: '1.0.0',
    category: 'knowledge',
    keywords: ['highlight', 'highlights', 'note', 'notes', 'annotation', 'what did i learn',
      'i wrote down', 'i saved', 'quote'],
    enabled: true,
  }),
  save_note: meta({
    name: 'save_note',
    version: '1.0.0',
    category: 'knowledge',
    keywords: ['save this', 'write that down', 'make a note', 'jot down', 'keep this'],
    enabled: true,
  }),

  /* ---- health: hidden without a live grant ---- */
  list_health_records: meta({
    name: 'list_health_records',
    version: '1.0.0',
    category: 'health',
    keywords: ['health', 'weight', 'sleep', 'steps', 'heart rate', 'blood pressure', 'symptom',
      'medication', 'vitals'],
    enabled: true,
  }),

  /* ---- reaching the user ---- */
  send_notification: meta({
    name: 'send_notification',
    version: '1.0.0',
    category: 'notifications',
    keywords: ['notify me', 'push', 'alert me', 'ping me', 'let me know'],
    enabled: true,
  }),

  /* ---- schedules: the clock ---- */
  list_schedules: meta({
    name: 'list_schedules',
    version: '1.0.0',
    category: 'schedules',
    keywords: ['schedule', 'schedules', 'recurring', 'every day', 'every morning', 'reminder',
      'routine', 'automation'],
    enabled: true,
  }),
  create_schedule: meta({
    name: 'create_schedule',
    version: '1.0.0',
    category: 'schedules',
    keywords: ['every morning', 'every day', 'daily', 'weekly', 'each monday', 'remind me every',
      'brief me', 'recurring'],
    dependencies: ['get_now'],
    enabled: true,
  }),
  delete_schedule: meta({
    name: 'delete_schedule',
    version: '1.0.0',
    category: 'schedules',
    keywords: ['stop reminding', 'cancel the schedule', 'turn off the daily', 'unsubscribe'],
    dependencies: ['list_schedules'],
    enabled: true,
  }),

  /* ---- email ---- */
  list_emails: meta({
    name: 'list_emails',
    version: '1.0.0',
    category: 'email',
    keywords: ['email', 'emails', 'inbox', 'mail', 'unread', 'message from', 'who emailed'],
    enabled: true,
  }),
  search_emails: meta({
    name: 'search_emails',
    version: '1.0.0',
    category: 'email',
    keywords: ['email about', 'find the email', 'search my mail', 'that email from'],
    enabled: true,
  }),
  /* ---- training and what you follow (Phase 20.5 / 20.6) ---- */
  list_activities: meta({
    name: 'list_activities',
    version: '1.0.0',
    category: 'fitness',
    keywords: ['workout', 'work out', 'training', 'trained', 'run', 'ran', 'running', 'ride',
      'cycling', 'swim', 'gym', 'strava', 'exercise', 'rest day', 'mileage', 'fitness',
      'how far', 'this week'],
    dependencies: ['get_now'],
    enabled: true,
  }),
  follow_interest: meta({
    name: 'follow_interest',
    version: '1.0.0',
    category: 'interests',
    keywords: ['follow', 'keep me updated', 'keep an eye', 'let me know about', 'track',
      'my team', 'i support', 'favourite', 'favorite', 'i am a fan', 'watch for', 'notify me about'],
    enabled: true,
  }),
  list_interests: meta({
    name: 'list_interests',
    version: '1.0.0',
    category: 'interests',
    keywords: ['following', 'watching', 'keeping an eye', 'what do you track', 'my interests'],
    enabled: true,
  }),
  update_interest: meta({
    name: 'update_interest',
    version: '1.0.0',
    category: 'interests',
    keywords: ['stop following', 'unfollow', 'mute', 'pause', 'less often', 'bored of',
      'stop telling me', 'too many updates'],
    dependencies: ['list_interests'],
    enabled: true,
  }),

  /* ---- the internet (Phase 20) ---- */
  web_search: meta({
    name: 'web_search',
    version: '1.0.0',
    category: 'research',
    // 'latest' deliberately belongs to news_search, not here: "the latest on
    // X" is a news question, and answering it from an encyclopaedia produces
    // a page of all-time statistics and no news, which is what happened.
    keywords: ['search', 'look up', 'google', 'find out', 'what is', 'who is', 'how do i',
      'how to', 'online', 'web', 'research', 'compare', 'reviews', 'price', 'best',
      'recommend', 'current'],
    dependencies: ['fetch_page'],
    enabled: true,
  }),
  news_search: meta({
    name: 'news_search',
    version: '1.0.0',
    category: 'news',
    keywords: ['news', 'latest', 'headlines', 'happening', 'happened', 'update on',
      'story', 'announced', 'reported', 'latest on', 'recent', 'what is going on',
      'what is new', 'any update'],
    enabled: true,
  }),
  fetch_page: meta({
    name: 'fetch_page',
    version: '1.0.0',
    category: 'research',
    keywords: ['this link', 'this url', 'this page', 'this article', 'read this',
      'what does it say', 'http', 'https', 'website'],
    enabled: true,
  }),
  sports_fixtures: meta({
    name: 'sports_fixtures',
    version: '1.0.0',
    category: 'sports',
    keywords: ['match', 'matches', 'fixture', 'fixtures', 'game', 'games', 'playing',
      'play', 'cricket', 'football', 'score', 'result', 'results', 'tournament',
      'series', 'world cup', 'kickoff', 'vs'],
    dependencies: ['get_now'],
    enabled: true,
  }),
  get_weather: meta({
    name: 'get_weather',
    version: '1.0.0',
    category: 'weather',
    keywords: ['weather', 'rain', 'raining', 'forecast', 'temperature', 'hot', 'cold',
      'sunny', 'wind', 'humid', 'outside', 'outdoors', 'run', 'ride', 'walk', 'train',
      'workout', 'work out', 'gym'],
    enabled: true,
  }),

  send_email: meta({
    name: 'send_email',
    version: '1.0.0',
    category: 'email',
    keywords: ['send an email', 'reply to', 'email them', 'write to', 'draft an email'],
    dependencies: ['list_emails'],
    enabled: true,
  }),
};
