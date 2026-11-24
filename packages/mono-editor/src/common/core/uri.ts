export interface UriComponents {
  scheme: string;
  authority?: string;
  path?: string;
  query?: string;
  fragment?: string;
}

const URI_RE = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

/**
 * Lightweight Monaco-compatible URI value object.
 */
export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(scheme: string, authority = '', path = '', query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  get fsPath(): string {
    return this.path;
  }

  with(change: {
    scheme?: string;
    authority?: string | null;
    path?: string | null;
    query?: string | null;
    fragment?: string | null;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority === null ? '' : (change.authority ?? this.authority),
      change.path === null ? '' : (change.path ?? this.path),
      change.query === null ? '' : (change.query ?? this.query),
      change.fragment === null ? '' : (change.fragment ?? this.fragment),
    );
  }

  toString(_skipEncoding = false): string {
    let out = '';
    if (this.scheme) out += `${this.scheme}:`;
    if (this.authority || this.scheme === 'file') out += `//${this.authority}`;
    if (this.path) {
      if (this.authority && !this.path.startsWith('/')) out += '/';
      out += this.path;
    }
    if (this.query) out += `?${this.query}`;
    if (this.fragment) out += `#${this.fragment}`;
    return out;
  }

  toJSON(): UriComponents {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }

  static parse(value: string): Uri {
    const m = URI_RE.exec(value);
    if (!m) return new Uri('', '', value);
    return new Uri(m[2] ?? '', m[4] ?? '', m[5] ?? '', m[7] ?? '', m[9] ?? '');
  }

  static file(path: string): Uri {
    const normalized = path.replace(/\\/g, '/');
    return new Uri('file', '', normalized.startsWith('/') ? normalized : `/${normalized}`);
  }

  static from(components: UriComponents): Uri {
    return new Uri(
      components.scheme,
      components.authority ?? '',
      components.path ?? '',
      components.query ?? '',
      components.fragment ?? '',
    );
  }

  static isUri(thing: unknown): thing is Uri {
    return thing instanceof Uri;
  }
}
