// ── Skill alias map ───────────────────────────────────────────────────────────
// Maps verbose or prefixed skill names to their canonical short form.
// Keys are lowercase for case-insensitive lookup; values are the canonical name.
//
// Why this exists:
//   LLMs and job postings often write "Apache Kafka" while CVs write "Kafka".
//   Without normalization these never match in the vector store, even though
//   they are the same skill. Add entries here whenever you spot a mismatch.
//
// Rules:
//   - Key:   lowercase, full verbose form as it typically appears in raw text
//   - Value: canonical short name, correctly cased (title case or acronym)
//   - One canonical form per skill — pick the most widely recognised short name
//   - Do not duplicate: if "apache kafka" → "Kafka", don't also add "kafka" → "Kafka"

export const SKILL_ALIASES: Record<string, string> = {
  // ── Apache ecosystem ────────────────────────────────────────────────────────
  'apache kafka':        'Kafka',
  'apache spark':        'Spark',
  'apache maven':        'Maven',
  'apache flink':        'Flink',
  'apache airflow':      'Airflow',
  'apache cassandra':    'Cassandra',
  'apache hadoop':       'Hadoop',
  'apache hive':         'Hive',
  'apache tomcat':       'Tomcat',
  'apache camel':        'Camel',
  'apache pulsar':       'Pulsar',
  'apache beam':         'Beam',

  // ── Cloud providers ─────────────────────────────────────────────────────────
  'amazon web services': 'AWS',
  'microsoft azure':     'Azure',
  'google cloud platform': 'GCP',
  'google cloud':        'GCP',

  // ── JavaScript / Node ecosystem ─────────────────────────────────────────────
  'node.js':             'Node.js',
  'nodejs':              'Node.js',
  'vue.js':              'Vue.js',
  'vuejs':               'Vue.js',
  'next.js':             'Next.js',
  'nextjs':              'Next.js',
  'nuxt.js':             'Nuxt.js',
  'nuxtjs':              'Nuxt.js',
  'express.js':          'Express.js',
  'expressjs':           'Express.js',
  'nest.js':             'NestJS',
  'nestjs':              'NestJS',
  'three.js':            'Three.js',

  // ── Databases ───────────────────────────────────────────────────────────────
  'postgresql':          'PostgreSQL',
  'mongo db':            'MongoDB',
  'elastic search':      'Elasticsearch',

  // ── DevOps / infrastructure ──────────────────────────────────────────────────
  'open shift':          'OpenShift',
  'git hub':             'GitHub',
  'git lab':             'GitLab',
  'github actions':      'GitHub Actions',
  'azure devops':        'Azure DevOps',
  'azure dev ops':       'Azure DevOps',
};
