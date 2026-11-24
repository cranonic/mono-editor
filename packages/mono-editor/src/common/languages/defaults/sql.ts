import { createRegexTokensProvider } from '../tokenization/createRegexTokensProvider';
import type { MonoTokensProvider } from '../tokenization/TokensProvider';

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'create', 'alter', 'drop', 'table', 'index', 'view', 'trigger',
  'database', 'schema', 'join', 'inner', 'left', 'right', 'full', 'outer',
  'cross', 'on', 'using', 'group', 'by', 'having', 'order', 'asc', 'desc',
  'limit', 'offset', 'union', 'all', 'distinct', 'as', 'and', 'or', 'not',
  'in', 'is', 'null', 'like', 'ilike', 'between', 'exists', 'case', 'when',
  'then', 'else', 'end', 'primary', 'key', 'foreign', 'references', 'unique',
  'check', 'default', 'constraint', 'not', 'true', 'false', 'with', 'recursive',
  'returning', 'begin', 'commit', 'rollback', 'transaction', 'explain', 'analyze',
  'int', 'integer', 'bigint', 'smallint', 'varchar', 'text', 'boolean', 'bool',
  'date', 'timestamp', 'numeric', 'decimal', 'float', 'real', 'json', 'jsonb',
  'uuid', 'serial', 'count', 'sum', 'avg', 'min', 'max', 'coalesce',
  // uppercase forms too
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON', 'GROUP', 'BY', 'HAVING',
  'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'UNIQUE', 'DEFAULT', 'TRUE', 'FALSE', 'WITH', 'RETURNING', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'INT', 'INTEGER', 'BIGINT', 'VARCHAR', 'TEXT', 'BOOLEAN',
  'TIMESTAMP', 'NUMERIC', 'JSONB', 'UUID', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
];

/** State: 0 normal, 1 block comment */
export function createSqlTokensProvider(languageId = 'sql'): MonoTokensProvider {
  return createRegexTokensProvider({
    languageId,
    keywords: SQL_KEYWORDS,
    initialState: 0,
    rules: [
      // block comment continue
      { pattern: /[\s\S]*?\*\//, type: 'comment', whenState: 1, nextState: 0 },
      { pattern: /[\s\S]+/, type: 'comment', whenState: 1, nextState: 1 },
      // line comment
      { pattern: /--.*/, type: 'comment' },
      // block comment
      { pattern: /\/\*[\s\S]*?\*\//, type: 'comment' },
      { pattern: /\/\*[\s\S]*/, type: 'comment', nextState: 1 },
      // strings
      { pattern: /'(?:''|[^'])*'/, type: 'string' },
      { pattern: /"(?:""|[^"])*"/, type: 'property' },
      // parameters ($1, :name, @var)
      { pattern: /(?:\$\d+|:[A-Za-z_]\w*|@[A-Za-z_]\w*)/, type: 'variable' },
      // built-in aggregate & scalar functions
      { pattern: /\b(?:COUNT|SUM|AVG|MIN|MAX|COALESCE|NOW|LOWER|UPPER|LENGTH|SUBSTRING|TRIM|CAST|ROUND|ABS|count|sum|avg|min|max|coalesce|now|lower|upper|length|substring|trim|cast|round|abs)(?=\s*\()/, type: 'function' },
      // numbers
      { pattern: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, type: 'number' },
      // operators
      { pattern: /<>|!=|<=|>=|\|\||::|[+\-*/%=<>]/, type: 'operator' },
    ],
  });
}
