// packages/app/src/features/lsp/workers/libDts.ts
// Lightweight browser/DOM/Node ambient declarations plus minimal ES fallback
// so Web Worker TypeScript LSP has console, fetch, timers, DOM, and core ES globals
// without requiring multi-megabyte full lib.dom.d.ts.

export const DOM_MINIMAL_DTS = `
/** The \`console\` object provides access to the browser's debugging console. */
interface Console {
  /** Outputs a message to the web console. */
  log(...data: any[]): void;
  /** Outputs an informational message to the console. */
  info(...data: any[]): void;
  /** Outputs a warning message to the console. */
  warn(...data: any[]): void;
  /** Outputs an error message to the console. */
  error(...data: any[]): void;
  /** Outputs a debug message to the console. */
  debug(...data: any[]): void;
  /** Outputs a stack trace to the console. */
  trace(...data: any[]): void;
  /** Displays an interactive list of the properties of the specified JavaScript object. */
  dir(item?: any, options?: any): void;
  /** Displays tabular data as a table. */
  table(tabularData?: any, properties?: readonly string[]): void;
  /** Starts a timer you can use to track how long an operation takes. */
  time(label?: string): void;
  /** Stops a timer previously started by calling \`console.time()\`. */
  timeEnd(label?: string): void;
  /** Clears the console if the environment allows it. */
  clear(): void;
  /** Writes an error message to the console if the assertion is false. */
  assert(condition?: boolean, ...data: any[]): void;
  /** Creates a new inline group in the console log. */
  group(...label: any[]): void;
  /** Exits the current inline group in the console. */
  groupEnd(): void;
  /** Logs the number of times that this particular call to \`count()\` has been called. */
  count(label?: string): void;
}
/**
 * Provides access to the debugging console (e.g., \`console.log()\`).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console)
 */
declare var console: Console;

/** Sets a timer which executes a function once the timer expires. */
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
/** Cancels a timeout previously established by calling \`setTimeout()\`. */
declare function clearTimeout(id?: number): void;
/** Repeatedly calls a function with a fixed time delay between each call. */
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
/** Cancels a timed, repeating action previously established by \`setInterval()\`. */
declare function clearInterval(id?: number): void;
/** Queues a microtask to be executed at a safe time prior to control returning to the event loop. */
declare function queueMicrotask(callback: () => void): void;
/** Creates a deep clone of a given value using the structured clone algorithm. */
declare function structuredClone<T>(value: T): T;
/** Tells the browser that you wish to perform an animation and requests a repaint callback. */
declare function requestAnimationFrame(callback: (time: number) => void): number;
/** Cancels an animation frame request previously scheduled through \`requestAnimationFrame()\`. */
declare function cancelAnimationFrame(handle: number): void;

interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callbackfn: (value: string, key: string, parent: Headers) => void): void;
}
declare var Headers: { new(init?: Record<string, string> | [string, string][]): Headers };

/** Represents the response to a \`fetch()\` request. */
interface Response {
  /** A boolean indicating whether the response was successful (status in the range 200–299). */
  readonly ok: boolean;
  /** The status code of the response (e.g., 200 for success). */
  readonly status: number;
  /** The status message corresponding to the status code. */
  readonly statusText: string;
  /** The URL of the response. */
  readonly url: string;
  /** The \`Headers\` object associated with the response. */
  readonly headers: Headers;
  /** Resolves with a \`string\` representation of the response body. */
  text(): Promise<string>;
  /** Resolves with the result of parsing the response body text as JSON. */
  json(): Promise<any>;
  /** Resolves with an \`ArrayBuffer\` representation of the response body. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Creates a clone of the response object. */
  clone(): Response;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | ArrayBuffer | Uint8Array | null;
  signal?: AbortSignal;
  credentials?: 'omit' | 'same-origin' | 'include';
  mode?: 'cors' | 'no-cors' | 'same-origin';
}

interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  readonly reason: any;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: any): void;
}

/**
 * Starts the process of fetching a resource from the network, returning a promise that resolves to the \`Response\`.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)
 */
declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;

declare class URL {
  constructor(url: string, base?: string | URL);
  href: string;
  origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}

declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | string[][]);
  append(name: string, value: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
  toString(): string;
}

interface Event {
  readonly type: string;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

interface AddEventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface EventTarget {
  /** Registers an event handler of a specific event type on the target. */
  addEventListener(type: string, listener: (ev: any) => void, options?: boolean | AddEventListenerOptions): void;
  /** Removes an event listener previously registered with \`addEventListener()\`. */
  removeEventListener(type: string, listener: (ev: any) => void, options?: boolean | AddEventListenerOptions): void;
  /** Dispatches an \`Event\` at the specified target. */
  dispatchEvent(event: Event): boolean;
}

interface DOMTokenList {
  readonly length: number;
  value: string;
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
  contains(token: string): boolean;
  replace(token: string, newToken: string): boolean;
}

interface DOMRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface Node extends EventTarget {
  readonly nodeName: string;
  readonly nodeType: number;
  readonly parentNode: Node | null;
  readonly parentElement: HTMLElement | null;
  readonly childNodes: Node[];
  readonly firstChild: Node | null;
  readonly lastChild: Node | null;
  readonly nextSibling: Node | null;
  readonly previousSibling: Node | null;
  textContent: string | null;
  /** Adds a node to the end of the list of children of this parent node. */
  appendChild<T extends Node>(node: T): T;
  /** Removes a child node from the DOM and returns the removed node. */
  removeChild<T extends Node>(child: T): T;
  /** Inserts a node before a reference node as a child of this parent node. */
  insertBefore<T extends Node>(node: T, child: Node | null): T;
  /** Returns a duplicate of the node on which this method was called. */
  cloneNode(deep?: boolean): Node;
  /** Returns a boolean indicating whether a node is a descendant of this node. */
  contains(other: Node | null): boolean;
}

interface DocumentFragment extends Node {
  readonly children: HTMLElement[];
  readonly childElementCount: number;
  querySelector<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
  querySelectorAll<E extends HTMLElement = HTMLElement>(selectors: string): E[];
}

interface HTMLElement extends Node {
  id: string;
  className: string;
  readonly classList: DOMTokenList;
  readonly tagName: string;
  innerHTML: string;
  outerHTML: string;
  innerText: string;
  hidden: boolean;
  title: string;
  tabIndex: number;
  readonly dataset: Record<string, string | undefined>;
  readonly style: Record<string, string>;
  readonly children: HTMLElement[];
  readonly childElementCount: number;
  readonly firstElementChild: HTMLElement | null;
  readonly lastElementChild: HTMLElement | null;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  scrollTop: number;
  scrollLeft: number;
  /** Returns the first descendant element matching the specified CSS selector. */
  querySelector<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
  /** Returns all descendant elements matching the specified CSS selector. */
  querySelectorAll<E extends HTMLElement = HTMLElement>(selectors: string): E[];
  /** Returns the value of a specified attribute on the element. */
  getAttribute(qualifiedName: string): string | null;
  /** Sets the value of an attribute on the specified element. */
  setAttribute(qualifiedName: string, value: string): void;
  /** Removes an attribute from the specified element. */
  removeAttribute(qualifiedName: string): void;
  /** Returns true if the element has the specified attribute. */
  hasAttribute(qualifiedName: string): boolean;
  /** Returns the closest ancestor element matching the specified selector. */
  closest<E extends HTMLElement = HTMLElement>(selector: string): E | null;
  /** Returns true if the element would be selected by the specified CSS selector. */
  matches(selectors: string): boolean;
  /** Returns a \`DOMRect\` providing information about the size of an element and its position relative to the viewport. */
  getBoundingClientRect(): DOMRect;
  /** Inserts nodes or strings after the last child of the element. */
  append(...nodes: (Node | string)[]): void;
  /** Inserts nodes or strings before the first child of the element. */
  prepend(...nodes: (Node | string)[]): void;
  /** Removes the element from the DOM. */
  remove(): void;
  /** Sets focus on the specified element. */
  focus(): void;
  /** Removes keyboard focus from the current element. */
  blur(): void;
  /** Simulates a mouse click on the element. */
  click(): void;
}

interface Location {
  href: string;
  readonly origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  reload(): void;
  replace(url: string | URL): void;
  assign(url: string | URL): void;
}

interface Storage {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/**
 * The \`Document\` interface represents any web page loaded in the browser and serves as
 * an entry point into the web page's content, which is the DOM tree.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Document)
 */
interface Document extends Node {
  /** Gets or sets the title of the document. */
  title: string;
  /** Returns the \`<body>\` or \`<frameset>\` node of the current document. */
  readonly body: HTMLElement;
  /** Returns the \`<head>\` element of the current document. */
  readonly head: HTMLElement;
  /** Returns the \`Element\` that is the root element of the document (for example, the \`<html>\` element). */
  readonly documentElement: HTMLElement;
  /** Returns the element within the document that currently has focus. */
  readonly activeElement: HTMLElement | null;
  /** Returns the document location as a string. */
  readonly URL: string;
  /** Returns the document location as a string. */
  readonly documentURI: string;
  /** Returns the \`Location\` object, which contains information about the URL of the document. */
  readonly location: Location;
  /** Returns the URI of the page that linked to this page. */
  readonly referrer: string;
  /** Gets and sets the cookies associated with the current document. */
  cookie: string;
  /** Returns the loading status of the document (\`"loading"\`, \`"interactive"\`, or \`"complete"\`). */
  readonly readyState: 'loading' | 'interactive' | 'complete';
  /** Returns \`true\` if the page is currently hidden, and \`false\` otherwise. */
  readonly hidden: boolean;
  /** Returns the visibility state of the document (\`"visible"\` or \`"hidden"\`). */
  readonly visibilityState: 'visible' | 'hidden';
  /** Returns the \`window\` object associated with the document. */
  readonly defaultView: Window | null;
  /** Returns the character encoding of the document. */
  readonly characterSet: string;
  /** Returns the MIME type that the document is being rendered as. */
  readonly contentType: string;
  /** Returns the text direction of the document (\`"ltr"\` or \`"rtl"\`). */
  dir: string;
  /** Returns the element currently presented in full-screen mode, or \`null\`. */
  readonly fullscreenElement: HTMLElement | null;
  /** Indicates whether full-screen mode is available. */
  readonly fullscreenEnabled: boolean;
  /** Returns the \`Element\` that scrolls the document. */
  readonly scrollingElement: HTMLElement | null;
  /** Returns a list of all \`<form>\` elements in the document. */
  readonly forms: HTMLElement[];
  /** Returns a list of all \`<img>\` elements in the document. */
  readonly images: HTMLElement[];
  /** Returns a list of all \`<a>\` and \`<area>\` elements with an \`href\` attribute. */
  readonly links: HTMLElement[];
  /** Returns a list of all \`<script>\` elements in the document. */
  readonly scripts: HTMLElement[];
  /** Returns the child elements of the document. */
  readonly children: HTMLElement[];
  /** Returns the number of child elements of the document. */
  readonly childElementCount: number;
  /** Returns the first child element of the document. */
  readonly firstElementChild: HTMLElement | null;
  /** Returns the last child element of the document. */
  readonly lastElementChild: HTMLElement | null;
  /**
   * Returns an \`HTMLElement\` representing the element whose \`id\` property matches the specified string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Document/getElementById)
   * @param elementId The ID of the element to locate. The ID is a case-sensitive string which is unique within the document.
   */
  getElementById(elementId: string): HTMLElement | null;
  /**
   * Returns all child elements which have all of the given class name(s).
   * @param classNames A string representing the class name(s) to match.
   */
  getElementsByClassName(classNames: string): HTMLElement[];
  /**
   * Returns a list of elements with the given tag name.
   * @param qualifiedName The qualified name to look for. The special string \`"*"\` represents all elements.
   */
  getElementsByTagName(qualifiedName: string): HTMLElement[];
  /**
   * Returns a list of elements with a given \`name\` attribute in the document.
   * @param elementName The value of the \`name\` attribute of the element(s).
   */
  getElementsByName(elementName: string): HTMLElement[];
  /**
   * Returns the first \`Element\` within the document that matches the specified selector, or group of selectors.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Document/querySelector)
   * @param selectors A string containing one or more CSS selectors to match.
   */
  querySelector<E extends HTMLElement = HTMLElement>(selectors: string): E | null;
  /**
   * Returns a list of the document's elements that match the specified group of selectors.
   * @param selectors A string containing one or more CSS selectors to match.
   */
  querySelectorAll<E extends HTMLElement = HTMLElement>(selectors: string): E[];
  /**
   * Creates the HTML element specified by \`tagName\`.
   * @param tagName A string that specifies the type of element to be created (e.g., \`"div"\`, \`"span"\`).
   */
  createElement(tagName: string): HTMLElement;
  /**
   * Creates a new text node.
   * @param data A string containing the data to be put in the text node.
   */
  createTextNode(data: string): Node;
  /** Creates a new empty \`DocumentFragment\` into which DOM nodes can be added. */
  createDocumentFragment(): DocumentFragment;
  /** Returns the topmost \`Element\` at the specified viewport coordinates. */
  elementFromPoint(x: number, y: number): HTMLElement | null;
  /** Returns an array of all elements at the specified viewport coordinates. */
  elementsFromPoint(x: number, y: number): HTMLElement[];
  /** Returns a boolean value indicating whether the document or any element inside it has focus. */
  hasFocus(): boolean;
  /** Writes a string of text to a document stream opened by \`document.open()\`. */
  write(...text: string[]): void;
  /** Opens a document for writing. */
  open(): Document;
  /** Finishes writing to a document, opened with \`document.open()\`. */
  close(): void;
  /** Requests that the element on this document currently presented in fullscreen mode be taken out of fullscreen mode. */
  exitFullscreen(): Promise<void>;
  /** Creates a copy of a node from an external document that can be inserted into the current document. */
  importNode<T extends Node>(node: T, deep?: boolean): T;
  /** Transfers a node from another document into the current document. */
  adoptNode<T extends Node>(node: T): T;
}

/** Represents a window containing a DOM document. */
interface Window extends EventTarget {
  /** Returns a reference to the \`Document\` contained in the window. */
  readonly document: Document;
  /** Returns the \`Location\` object for the current window. */
  readonly location: Location;
  /** Returns the interior width of the window in pixels. */
  readonly innerWidth: number;
  /** Returns the interior height of the window in pixels. */
  readonly innerHeight: number;
  /** Returns the ratio of the resolution in physical pixels to CSS pixels. */
  readonly devicePixelRatio: number;
  /** Allows access to a \`Storage\` object for the Document's origin. */
  readonly localStorage: Storage;
  /** Allows access to a session \`Storage\` object for the current origin. */
  readonly sessionStorage: Storage;
  /** Information about the user agent / browser environment. */
  readonly navigator: {
    readonly userAgent: string;
    readonly language: string;
    readonly languages: readonly string[];
    readonly onLine: boolean;
    readonly clipboard: { readText(): Promise<string>; writeText(data: string): Promise<void> };
  };
  /** Provides methods for working with the browser session history. */
  readonly history: {
    readonly length: number;
    readonly state: any;
    back(): void;
    forward(): void;
    go(delta?: number): void;
    pushState(data: any, unused: string, url?: string | URL | null): void;
    replaceState(data: any, unused: string, url?: string | URL | null): void;
  };
  /** Displays an alert dialog with the specified message. */
  alert(message?: any): void;
  /** Displays a modal dialog with an optional message and OK/Cancel buttons. */
  confirm(message?: string): boolean;
  /** Displays a dialog with an optional message prompting the user to input some text. */
  prompt(message?: string, defaultText?: string): string | null;
  /** Scrolls to a particular set of coordinates in the document. */
  scrollTo(x: number, y: number): void;
  /** Returns an object containing the values of all CSS properties of an element. */
  getComputedStyle(elt: HTMLElement, pseudoElt?: string | null): Record<string, string>;
}

/**
 * Represents the browser window containing the DOM document.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window)
 */
declare var window: Window;
/**
 * Represents any web page loaded in the browser and serves as an entry point
 * into the web page's content, which is the DOM tree.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/document)
 */
declare var document: Document;
declare var localStorage: Storage;
declare var sessionStorage: Storage;
declare var location: Location;
declare var navigator: Window['navigator'];
declare var history: Window['history'];
declare var globalThis: typeof globalThis;
`;

export const MINIMAL_ES_FALLBACK_DTS = `
interface PropertyKey {}
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;

interface Object {
  toString(): string;
  valueOf(): Object;
  hasOwnProperty(v: PropertyKey): boolean;
}
interface ObjectConstructor {
  keys(o: object): string[];
  values<T>(o: { [s: string]: T }): T[];
  entries<T>(o: { [s: string]: T }): [string, T][];
  assign<T extends {}, U>(target: T, source: U): T & U;
  freeze<T>(o: T): Readonly<T>;
}
declare var Object: ObjectConstructor;

interface Function {
  apply(this: Function, thisArg: any, argArray?: any): any;
  call(this: Function, thisArg: any, ...argArray: any[]): any;
  bind(this: Function, thisArg: any, ...argArray: any[]): any;
  readonly length: number;
  readonly name: string;
}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; [index: number]: any; }

interface String {
  readonly length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  includes(searchString: string, position?: number): boolean;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  trim(): string;
  toLowerCase(): string;
  toUpperCase(): string;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  match(regexp: string | RegExp): RegExpMatchArray | null;
}
interface StringConstructor { (value?: any): string; new(value?: any): String; }
declare var String: StringConstructor;

interface Number {
  toFixed(fractionDigits?: number): string;
  toString(radix?: number): string;
}
interface NumberConstructor {
  (value?: any): number;
  isNaN(number: unknown): boolean;
  isFinite(number: unknown): boolean;
  parseInt(string: string, radix?: number): number;
  parseFloat(string: string): number;
}
declare var Number: NumberConstructor;

interface Boolean { valueOf(): boolean; }
interface BooleanConstructor { (value?: any): boolean; }
declare var Boolean: BooleanConstructor;

interface RegExpMatchArray extends Array<string> { index?: number; input?: string; }
interface RegExp { test(string: string): boolean; exec(string: string): RegExpMatchArray | null; readonly source: string; }
interface RegExpConstructor { new(pattern: string | RegExp, flags?: string): RegExp; }
declare var RegExp: RegExpConstructor;

interface Array<T> {
  length: number;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  concat(...items: (T | ReadonlyArray<T>)[]): T[];
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  indexOf(searchElement: T, fromIndex?: number): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown): T[];
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  find(predicate: (value: T, index: number, obj: T[]) => unknown): T | undefined;
  some(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  every(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  sort(compareFn?: (a: T, b: T) => number): this;
  [n: number]: T;
}
interface ReadonlyArray<T> {
  readonly length: number;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown): T[];
  includes(searchElement: T, fromIndex?: number): boolean;
  [n: number]: T;
}
interface ArrayConstructor {
  isArray(arg: any): arg is any[];
  from<T>(arrayLike: Iterable<T> | ArrayLike<T>): T[];
}
declare var Array: ArrayConstructor;
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T; }

interface Symbol { readonly description: string | undefined; }
interface SymbolConstructor { readonly iterator: unique symbol; (description?: string | number): symbol; }
declare var Symbol: SymbolConstructor;
interface IteratorResult<T, TReturn = any> { done?: boolean; value: T; }
interface Iterator<T> { next(): IteratorResult<T>; }
interface Iterable<T> { [Symbol.iterator](): Iterator<T>; }
interface IterableIterator<T> extends Iterator<T>, Iterable<T> {}

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  resolve(): Promise<void>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T>(values: Iterable<T | PromiseLike<T>>): Promise<T[]>;
}
declare var Promise: PromiseConstructor;

interface Map<K, V> {
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
}
declare var Map: { new <K = any, V = any>(entries?: readonly (readonly [K, V])[] | null): Map<K, V> };

interface Set<T> {
  readonly size: number;
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  values(): IterableIterator<T>;
}
declare var Set: { new <T = any>(values?: readonly T[] | null): Set<T> };

interface Error { name: string; message: string; stack?: string; }
declare var Error: { new(message?: string): Error; (message?: string): Error; };

interface JSON {
  parse(text: string): any;
  stringify(value: any, replacer?: any, space?: string | number): string;
}
declare var JSON: JSON;

interface Math {
  abs(x: number): number;
  ceil(x: number): number;
  floor(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  round(x: number): number;
  random(): number;
  sqrt(x: number): number;
  readonly PI: number;
}
declare var Math: Math;

interface Date {
  getTime(): number;
  toISOString(): string;
}
declare var Date: { new(value?: number | string): Date; now(): number; };

declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function encodeURIComponent(uriComponent: string | number | boolean): string;
declare function decodeURIComponent(encodedURIComponent: string): string;
`;
