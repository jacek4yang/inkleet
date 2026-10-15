/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {SnippetBudget,SnippetLimitError,snippetLimits} from "../snippet-budget.ts";
// Pinned Microsoft source and modifications: third_party/vscode-snippet-parser/README.md.
const CharCode={DollarSign:36,Colon:58,Comma:44,OpenCurlyBrace:123,CloseCurlyBrace:125,Backslash:92,Slash:47,Pipe:124,Plus:43,Dash:45,QuestionMark:63,Digit0:48,Digit9:57,Underline:95,a:97,z:122,A:65,Z:90} as const;

export const TokenType = {Dollar:0,Colon:1,Comma:2,CurlyOpen:3,CurlyClose:4,Backslash:5,Forwardslash:6,Pipe:7,Int:8,VariableName:9,Format:10,Plus:11,Dash:12,QuestionMark:13,EOF:14} as const;
export type TokenType = typeof TokenType[keyof typeof TokenType];

export interface Token {
	type: TokenType;
	pos: number;
	len: number;
}


export class Scanner {
 constructor(readonlyBudget:SnippetBudget){this.budget=readonlyBudget;}
 private readonly budget:SnippetBudget;

	private static _table: { [ch: number]: TokenType } = {
		[CharCode.DollarSign]: TokenType.Dollar,
		[CharCode.Colon]: TokenType.Colon,
		[CharCode.Comma]: TokenType.Comma,
		[CharCode.OpenCurlyBrace]: TokenType.CurlyOpen,
		[CharCode.CloseCurlyBrace]: TokenType.CurlyClose,
		[CharCode.Backslash]: TokenType.Backslash,
		[CharCode.Slash]: TokenType.Forwardslash,
		[CharCode.Pipe]: TokenType.Pipe,
		[CharCode.Plus]: TokenType.Plus,
		[CharCode.Dash]: TokenType.Dash,
		[CharCode.QuestionMark]: TokenType.QuestionMark,
	};

	static isDigitCharacter(ch: number): boolean {
		return ch >= CharCode.Digit0 && ch <= CharCode.Digit9;
	}

	static isVariableCharacter(ch: number): boolean {
		return ch === CharCode.Underline
			|| (ch >= CharCode.a && ch <= CharCode.z)
			|| (ch >= CharCode.A && ch <= CharCode.Z);
	}

	value: string = '';
	pos: number = 0;

	text(value: string) {
        this.budget.source(value);
		this.value = value;
		this.pos = 0;
	}

	tokenText(token: Token): string {
		this.budget.copy(token.len);return this.value.substr(token.pos, token.len);
	}

	next(): Token {
        this.budget.step();

		if (this.pos >= this.value.length) {
			return { type: TokenType.EOF, pos: this.pos, len: 0 };
		}

		const pos = this.pos;
		let len = 0;
		let ch = this.value.charCodeAt(pos);
		let type: TokenType;

		// static types
		type = Scanner._table[ch];
		if (typeof type === 'number') {
			this.pos += 1;
			return { type, pos, len: 1 };
		}

		// number
		if (Scanner.isDigitCharacter(ch)) {
			type = TokenType.Int;
			do {
				len += 1;
				ch = this.value.charCodeAt(pos + len);
			} while (Scanner.isDigitCharacter(ch));

			this.pos += len;
			return { type, pos, len };
		}

		// variable name
		if (Scanner.isVariableCharacter(ch)) {
			type = TokenType.VariableName;
			do {
				ch = this.value.charCodeAt(pos + (++len));
			} while (Scanner.isVariableCharacter(ch) || Scanner.isDigitCharacter(ch));

			this.pos += len;
			return { type, pos, len };
		}


		// format
		type = TokenType.Format;
		do {
			len += 1;
			ch = this.value.charCodeAt(pos + len);
		} while (
			!isNaN(ch)
			&& typeof Scanner._table[ch] === 'undefined' // not static token
			&& !Scanner.isDigitCharacter(ch) // not number
			&& !Scanner.isVariableCharacter(ch) // not variable
		);

		this.pos += len;
		return { type, pos, len };
	}
}

export abstract class Marker {
 readonly budget:SnippetBudget;
 constructor(budget:SnippetBudget){this.budget=budget;budget.node();}

	readonly _markerBrand: undefined = undefined;

	public parent!: Marker;
	protected _children: Marker[] = [];

	appendChild(child: Marker): this {
		if (child instanceof Text && this._children[this._children.length - 1] instanceof Text) {
			// this and previous child are text -> merge them
			this.budget.copy((this._children[this._children.length - 1] as Text).value.length+child.value.length);
            (this._children[this._children.length - 1] as Text).value += child.value;
		} else {
			// normal adoption of child
			child.parent = this;
			this._children.push(child);
		}
		return this;
	}

	replace(child: Marker, others: Marker[]): void {
		const { parent } = child;
		const idx = parent.children.indexOf(child);
		this.budget.step(parent.children.length+others.length);
        const newChildren = parent.children.slice(0);
		newChildren.splice(idx, 1, ...others);
		parent._children = newChildren;

		const stack=others.map(child=>({child,parent,depth:1}));
        while(stack.length){const entry=stack.pop()!;this.budget.step();this.budget.depthAt(entry.depth);entry.child.parent=entry.parent;
          for(const child of entry.child.children)stack.push({child,parent:entry.child,depth:entry.depth+1});
        }
	}

	get children(): Marker[] {
		return this._children;
	}

	get rightMostDescendant(): Marker {
		if (this._children.length > 0) {
			return this._children[this._children.length - 1].rightMostDescendant;
		}
		return this;
	}

	get snippet(): TextmateSnippet | undefined {
		let candidate: Marker = this;
		while (true) {
			if (!candidate) {
				return undefined;
			}
			if (candidate instanceof TextmateSnippet) {
				return candidate;
			}
			candidate = candidate.parent;
		}
	}

	toString(): string {
		return this.children.reduce((prev, cur) => prev + cur.toString(), '');
	}

	abstract toTextmateString(): string;

	len(): number {
		return 0;
	}

	abstract clone(): Marker;
}

export class Text extends Marker {

	static escape(value: string): string {
		return value.replace(/\$|}|\\/g, '\\$&');
	}

	public value:string;
 constructor(budget:SnippetBudget,value:string){super(budget);budget.copy(value.length);this.value=value;}
	override toString() {
		return this.value;
	}
	toTextmateString(): string {
		return Text.escape(this.value);
	}
	override len(): number {
		return this.value.length;
	}
	clone(): Text {return this.budget.nested(()=>{
		return new Text(this.budget, this.value);
 });
 }
}

export abstract class TransformableMarker extends Marker {
	public transform?: Transform;
}

export class Placeholder extends TransformableMarker {
	static compareByIndex(a: Placeholder, b: Placeholder): number {
		if (a.index === b.index) {
			return 0;
		} else if (a.isFinalTabstop) {
			return 1;
		} else if (b.isFinalTabstop) {
			return -1;
		} else if (a.index < b.index) {
			return -1;
		} else if (a.index > b.index) {
			return 1;
		} else {
			return 0;
		}
	}

	public index:number;
 constructor(budget:SnippetBudget,index:number){super(budget);budget.index(index);this.index=index;}

	get isFinalTabstop() {
		return this.index === 0;
	}

	get choice(): Choice | undefined {
		return this._children.length === 1 && this._children[0] instanceof Choice
			? this._children[0]
			: undefined;
	}

	toTextmateString(): string {
		let transformString = '';
		if (this.transform) {
			transformString = this.transform.toTextmateString();
		}
		if (this.children.length === 0 && !this.transform) {
			return `\$${this.index}`;
		} else if (this.children.length === 0) {
			return `\${${this.index}${transformString}}`;
		} else if (this.choice) {
			return `\${${this.index}|${this.choice.toTextmateString()}|${transformString}}`;
		} else {
			return `\${${this.index}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`;
		}
	}

	clone(): Placeholder {return this.budget.nested(()=>{
		const ret = new Placeholder(this.budget, this.index);
		if (this.transform) {
			ret.transform = this.transform.clone();
		}
		ret._children = this.children.map(child => child.clone());
		return ret;
 });
 }
}

export class Choice extends Marker {

	readonly options: Text[] = [];

	override appendChild(marker: Marker): this {
		if (marker instanceof Text) {
			this.budget.choice();marker.parent = this;
			this.options.push(marker);
		}
		return this;
	}

	override toString() {
		return this.options[0].value;
	}

	toTextmateString(): string {
		return this.options
			.map(option => option.value.replace(/\||,|\\/g, '\\$&'))
			.join(',');
	}

	override len(): number {
		return this.options[0].len();
	}

	clone(): Choice {return this.budget.nested(()=>{
		const ret = new Choice(this.budget);
		this.options.forEach(option=>ret.appendChild(option.clone()));
		return ret;
 });
 }
}

export class Transform extends Marker {
 regexSource="";regexFlags="";
 constructor(budget:SnippetBudget){super(budget);budget.transform();}
 resolve(_value:string):never{throw new Error("Snippet transforms require the evaluation worker");}
 override toString(){return "";}
 toTextmateString(){return "/"+this.regexSource+"/"+this.children.map(c=>c.toTextmateString()).join("")+"/"+this.regexFlags;}
 clone():Transform{return this.budget.nested(()=>{const ret=new Transform(this.budget);ret.regexSource=this.regexSource;ret.regexFlags=this.regexFlags;for(const child of this.children)ret.appendChild(child.clone());return ret;});}
}

export class FormatString extends Marker {

	readonly index:number;readonly shorthandName?:string;readonly ifValue?:string;readonly elseValue?:string;
 constructor(budget:SnippetBudget,index:number,shorthandName?:string,ifValue?:string,elseValue?:string){
 super(budget);budget.index(index);budget.copy((shorthandName?.length??0)+(ifValue?.length??0)+(elseValue?.length??0));
 this.index=index;this.shorthandName=shorthandName;this.ifValue=ifValue;this.elseValue=elseValue;
 }

 resolve(_value?:string):never{throw new Error("Snippet transforms require the evaluation worker");}

	toTextmateString(): string {
		let value = '${';
		value += this.index;
		if (this.shorthandName) {
			value += `:/${this.shorthandName}`;

		} else if (this.ifValue && this.elseValue) {
			value += `:?${this.ifValue}:${this.elseValue}`;
		} else if (this.ifValue) {
			value += `:+${this.ifValue}`;
		} else if (this.elseValue) {
			value += `:-${this.elseValue}`;
		}
		value += '}';
		return value;
	}

	clone(): FormatString {return this.budget.nested(()=>{
		const ret = new FormatString(this.budget, this.index, this.shorthandName, this.ifValue, this.elseValue);
		return ret;
 });
 }
}

export class Variable extends TransformableMarker {

	public name:string;
 constructor(budget:SnippetBudget,name:string){super(budget);budget.copy(name.length);this.name=name;}

	resolve(resolver: VariableResolver): boolean {
		let value = resolver.resolve(this);
		if (this.transform) {
			value = this.transform.resolve(value || '');
		}
		if (value !== undefined) {
			this._children = [new Text(this.budget, value)];
			return true;
		}
		return false;
	}

	toTextmateString(): string {
		let transformString = '';
		if (this.transform) {
			transformString = this.transform.toTextmateString();
		}
		if (this.children.length === 0) {
			return `\${${this.name}${transformString}}`;
		} else {
			return `\${${this.name}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`;
		}
	}

	clone(): Variable {return this.budget.nested(()=>{
		const ret = new Variable(this.budget, this.name);
		if (this.transform) {
			ret.transform = this.transform.clone();
		}
		ret._children = this.children.map(child => child.clone());
		return ret;
 });
 }
}

export interface VariableResolver {
	resolve(variable: Variable): string | undefined;
}

function walk(markers: Marker[], visitor: (marker: Marker) => boolean): void {
 const stack=markers.map(marker=>({marker,depth:0})).reverse();
 while(stack.length){const {marker,depth}=stack.pop()!;marker.budget.step();marker.budget.depthAt(depth);
 if(!visitor(marker))break;
 for(let i=marker.children.length-1;i>=0;i--)stack.push({marker:marker.children[i],depth:depth+1});
 }
}

export class TextmateSnippet extends Marker {

	private _placeholders?: { all: Placeholder[]; last?: Placeholder };

	get placeholderInfo() {
		if (!this._placeholders) {
			// fill in placeholders
			const all: Placeholder[] = [];
			let last: Placeholder | undefined;
			this.walk(function (candidate) {
				if (candidate instanceof Placeholder) {
					all.push(candidate);
					last = !last || last.index < candidate.index ? candidate : last;
				}
				return true;
			});
			this._placeholders = { all, last };
		}
		return this._placeholders;
	}

	get placeholders(): Placeholder[] {
		const { all } = this.placeholderInfo;
		return all;
	}

	offset(marker: Marker): number {
		let pos = 0;
		let found = false;
		this.walk(candidate => {
			if (candidate === marker) {
				found = true;
				return false;
			}
			pos += candidate.len();
			return true;
		});

		if (!found) {
			return -1;
		}
		return pos;
	}

	fullLen(marker: Marker): number {
		let ret = 0;
		walk([marker], marker => {
			ret += marker.len();
			return true;
		});
		return ret;
	}

	enclosingPlaceholders(placeholder: Placeholder): Placeholder[] {
		const ret: Placeholder[] = [];
		let { parent } = placeholder;
		while (parent) {
			if (parent instanceof Placeholder) {
				ret.push(parent);
			}
			parent = parent.parent;
		}
		return ret;
	}

	resolveVariables(resolver: VariableResolver): this {
		this.walk(candidate => {
			if (candidate instanceof Variable) {
				if (candidate.resolve(resolver)) {
					this._placeholders = undefined;
				}
			}
			return true;
		});
		return this;
	}

	override appendChild(child: Marker) {
		this._placeholders = undefined;
		return super.appendChild(child);
	}

	override replace(child: Marker, others: Marker[]): void {
		this._placeholders = undefined;
		return super.replace(child, others);
	}

	toTextmateString(): string {
		return this.children.reduce((prev, cur) => prev + cur.toTextmateString(), '');
	}

	clone(): TextmateSnippet {return this.budget.nested(()=>{
		const ret = new TextmateSnippet(this.budget);
		ret._children = this.children.map(child => child.clone());
		return ret;
 });
 }

	walk(visitor: (marker: Marker) => boolean): void {
		walk(this.children, visitor);
	}
}

export class SnippetParser {

	static escape(value: string): string {
		return value.replace(/\$|}|\\/g, '\\$&');
	}

	/**
	 * Takes a snippet and returns the insertable string, e.g return the snippet-string
	 * without any placeholder, tabstop, variables etc...
	 */
	static asInsertText(value: string): string {
		return new SnippetParser().parse(value).toString();
	}

	static guessNeedsClipboard(template: string): boolean {
		return /\${?CLIPBOARD/.test(template);
	}

	private budget=new SnippetBudget();
 private _scanner: Scanner = new Scanner(this.budget);
	private _token: Token = { type: TokenType.EOF, pos: 0, len: 0 };

	parse(value: string, insertFinalTabstop?: boolean, enforceFinalTabstop?: boolean): TextmateSnippet {
		this.budget=new SnippetBudget();this._scanner=new Scanner(this.budget);
        const snippet = new TextmateSnippet(this.budget);
		this.parseFragment(value, snippet);
		this.ensureFinalTabstop(snippet, enforceFinalTabstop ?? false, insertFinalTabstop ?? false);
		return snippet;
	}

	parseFragment(value: string, snippet: TextmateSnippet): readonly Marker[] {

		const offset = snippet.children.length;
		this._scanner.text(value);
		this._token = this._scanner.next();
		while (this._parse(snippet)) {
			// nothing
		}

		// fill in values for placeholders. the first placeholder of an index
		// that has a value defines the value for all placeholders with that index
		const placeholderDefaultValues = new Map<number, Marker[] | undefined>();
		const incompletePlaceholders: Placeholder[] = [];
		snippet.walk(marker => {
			if (marker instanceof Placeholder) {
				if (marker.isFinalTabstop) {
					placeholderDefaultValues.set(0, undefined);
				} else if (!placeholderDefaultValues.has(marker.index) && marker.children.length > 0) {
					placeholderDefaultValues.set(marker.index, marker.children);
				} else {
					incompletePlaceholders.push(marker);
				}
			}
			return true;
		});

		const fillInIncompletePlaceholder = (placeholder: Placeholder, stack: Set<number>):void => this.budget.nested(()=>{
			const defaultValues = placeholderDefaultValues.get(placeholder.index);
			if (!defaultValues) {
				return;
			}
			const clone = new Placeholder(this.budget, placeholder.index);
			clone.transform = placeholder.transform;
			for (const child of defaultValues) {
				const newChild = child.clone();
				clone.appendChild(newChild);

				// "recurse" on children that are again placeholders
				if (newChild instanceof Placeholder && placeholderDefaultValues.has(newChild.index) && !stack.has(newChild.index)) {
					stack.add(newChild.index);
					fillInIncompletePlaceholder(newChild, stack);
					stack.delete(newChild.index);
				}
			}
			snippet.replace(placeholder, [clone]);
		});

		const stack = new Set<number>();
		for (const placeholder of incompletePlaceholders) {
			fillInIncompletePlaceholder(placeholder, stack);
		}

		return snippet.children.slice(offset);
	}

	ensureFinalTabstop(snippet: TextmateSnippet, enforceFinalTabstop: boolean, insertFinalTabstop: boolean) {

		if (enforceFinalTabstop || insertFinalTabstop && snippet.placeholders.length > 0) {
			const finalTabstop = snippet.placeholders.find(p => p.index === 0);
			if (!finalTabstop) {
				// the snippet uses placeholders but has no
				// final tabstop defined -> insert at the end
				snippet.appendChild(new Placeholder(this.budget, 0));
			}
		}

	}

	private _accept(type?: TokenType): boolean;
	private _accept(type: TokenType | undefined, value: true): string;
	private _accept(type: TokenType, value?: boolean): boolean | string {
		if (type === undefined || this._token.type === type) {
			const ret = !value ? true : this._scanner.tokenText(this._token);
			this._token = this._scanner.next();
			return ret;
		}
		return false;
	}

	private _backTo(token: Token): false {
        this.budget.step();
		this._scanner.pos = token.pos + token.len;
		this._token = token;
		return false;
	}

	private _until(type: TokenType): false | string {
		const start = this._token;
		while (this._token.type !== type) {
			if (this._token.type === TokenType.EOF) {
				return false;
			} else if (this._token.type === TokenType.Backslash) {
				const nextToken = this._scanner.next();
				if (nextToken.type !== TokenType.Dollar
					&& nextToken.type !== TokenType.CurlyClose
					&& nextToken.type !== TokenType.Backslash) {
					return false;
				}
			}
			this._token = this._scanner.next();
		}
		const value = this._scanner.value.substring(start.pos, this._token.pos).replace(/\\(\$|}|\\)/g, '$1');
		this._token = this._scanner.next();
		return value;
	}

	private _parse(marker: Marker): boolean {
		return this.budget.nested(()=> this._parseEscaped(marker)
			|| this._parseTabstopOrVariableName(marker)
			|| this._parseComplexPlaceholder(marker)
			|| this._parseComplexVariable(marker)
			|| this._parseAnything(marker));
	}

	// \$, \\, \} -> just text
	private _parseEscaped(marker: Marker): boolean {
		let value: string;
		if (value = this._accept(TokenType.Backslash, true)) {
			// saw a backslash, append escaped token or that backslash
			value = this._accept(TokenType.Dollar, true)
				|| this._accept(TokenType.CurlyClose, true)
				|| this._accept(TokenType.Backslash, true)
				|| value;

			marker.appendChild(new Text(this.budget, value));
			return true;
		}
		return false;
	}

	// $foo -> variable, $1 -> tabstop
	private _parseTabstopOrVariableName(parent: Marker): boolean {
		let value: string;
		const token = this._token;
		const match = this._accept(TokenType.Dollar)
			&& (value = this._accept(TokenType.VariableName, true) || this._accept(TokenType.Int, true));

		if (!match) {
			return this._backTo(token);
		}

		parent.appendChild(/^\d+$/.test(value!)
			? new Placeholder(this.budget, Number(value!))
			: new Variable(this.budget, value!)
		);
		return true;
	}

	// ${1:<children>}, ${1} -> placeholder
	private _parseComplexPlaceholder(parent: Marker): boolean {
		let index: string;
		const token = this._token;
		const match = this._accept(TokenType.Dollar)
			&& this._accept(TokenType.CurlyOpen)
			&& (index = this._accept(TokenType.Int, true));

		if (!match) {
			return this._backTo(token);
		}

		const placeholder = new Placeholder(this.budget, Number(index!));

		if (this._accept(TokenType.Colon)) {
			// ${1:<children>}
			while (true) {

				// ...} -> done
				if (this._accept(TokenType.CurlyClose)) {
					parent.appendChild(placeholder);
					return true;
				}

				if (this._parse(placeholder)) {
					continue;
				}

				// fallback
				throw new Error('Unclosed snippet placeholder');
                parent.appendChild(new Text(this.budget, '${' + index! + ':'));
				placeholder.children.forEach(parent.appendChild, parent);
				return true;
			}
		} else if (placeholder.index > 0 && this._accept(TokenType.Pipe)) {
			// ${1|one,two,three|}
			const choice = new Choice(this.budget);

			while (true) {
				if (this._parseChoiceElement(choice)) {

					if (this._accept(TokenType.Comma)) {
						// opt, -> more
						continue;
					}

					if (this._accept(TokenType.Pipe)) {
						placeholder.appendChild(choice);
						if (this._accept(TokenType.CurlyClose)) {
							// ..|} -> done
							parent.appendChild(placeholder);
							return true;
						}
					}
				}

				this._backTo(token);
				return false;
			}

		} else if (this._accept(TokenType.Forwardslash)) {
			// ${1/<regex>/<format>/<options>}
			if (this._parseTransform(placeholder)) {
				parent.appendChild(placeholder);
				return true;
			}

			this._backTo(token);
			return false;

		} else if (this._accept(TokenType.CurlyClose)) {
			// ${1}
			parent.appendChild(placeholder);
			return true;

		} else {
			// ${1 <- missing curly or colon
			return this._backTo(token);
		}
	}

	private _parseChoiceElement(parent: Choice): boolean {
		const token = this._token;
		const values: string[] = [];

		while (true) {
			if (this._token.type === TokenType.Comma || this._token.type === TokenType.Pipe) {
				break;
			}
			let value: string;
			if (value = this._accept(TokenType.Backslash, true)) {
				// \, \|, or \\
				value = this._accept(TokenType.Comma, true)
					|| this._accept(TokenType.Pipe, true)
					|| this._accept(TokenType.Backslash, true)
					|| value;
			} else {
				value = this._accept(undefined, true);
			}
			if (!value) {
				// EOF
				this._backTo(token);
				return false;
			}
			values.push(value);
		}

		if (values.length === 0) {
			this._backTo(token);
			return false;
		}

		parent.appendChild(new Text(this.budget, values.join('')));
		return true;
	}

	// ${foo:<children>}, ${foo} -> variable
	private _parseComplexVariable(parent: Marker): boolean {
		let name: string;
		const token = this._token;
		const match = this._accept(TokenType.Dollar)
			&& this._accept(TokenType.CurlyOpen)
			&& (name = this._accept(TokenType.VariableName, true));

		if (!match) {
			return this._backTo(token);
		}

		const variable = new Variable(this.budget, name!);

		if (this._accept(TokenType.Colon)) {
			// ${foo:<children>}
			while (true) {

				// ...} -> done
				if (this._accept(TokenType.CurlyClose)) {
					parent.appendChild(variable);
					return true;
				}

				if (this._parse(variable)) {
					continue;
				}

				// fallback
				throw new Error('Unclosed snippet variable');
                parent.appendChild(new Text(this.budget, '${' + name! + ':'));
				variable.children.forEach(parent.appendChild, parent);
				return true;
			}

		} else if (this._accept(TokenType.Forwardslash)) {
			// ${foo/<regex>/<format>/<options>}
			if (this._parseTransform(variable)) {
				parent.appendChild(variable);
				return true;
			}

			this._backTo(token);
			return false;

		} else if (this._accept(TokenType.CurlyClose)) {
			// ${foo}
			parent.appendChild(variable);
			return true;

		} else {
			// ${foo <- missing curly or colon
			return this._backTo(token);
		}
	}

	private _parseTransform(parent: TransformableMarker): boolean {
		// ...<regex>/<format>/<options>}

		const transform = new Transform(this.budget);
		let regexValue = '';
		let regexOptions = '';

		// (1) /regex
		while (true) {
			if (this._accept(TokenType.Forwardslash)) {
				break;
			}

			let escaped: string;
			if (escaped = this._accept(TokenType.Backslash, true)) {
				escaped = this._accept(TokenType.Forwardslash, true) || escaped;
				this.budget.copy(regexValue.length+(escaped).length);regexValue += escaped;
                if(regexValue.length>snippetLimits.pattern)throw new SnippetLimitError("Snippet pattern limit");
				continue;
			}

			if (this._token.type !== TokenType.EOF) {
				const part=this._accept(undefined,true);this.budget.copy(regexValue.length+part.length);regexValue += part;
                if(regexValue.length>snippetLimits.pattern)throw new SnippetLimitError("Snippet pattern limit");
				continue;
			}
			return false;
		}

		// (2) /format
		while (true) {
			if (this._accept(TokenType.Forwardslash)) {
				break;
			}

			let escaped: string;
			if (escaped = this._accept(TokenType.Backslash, true)) {
				escaped = this._accept(TokenType.Backslash, true) || this._accept(TokenType.Forwardslash, true) || escaped;
				transform.appendChild(new Text(this.budget, escaped));
				continue;
			}

			if (this._parseFormatString(transform) || this._parseAnything(transform)) {
				continue;
			}
			return false;
		}

		// (3) /option
		while (true) {
			if (this._accept(TokenType.CurlyClose)) {
				break;
			}
			if (this._token.type !== TokenType.EOF) {
				const part=this._accept(undefined,true);this.budget.copy(regexOptions.length+part.length);regexOptions += part;
				continue;
			}
			return false;
		}

        if(regexValue.length>snippetLimits.pattern||!/^[dgimsuvy]*$/.test(regexOptions)||new Set(regexOptions).size!==regexOptions.length||(regexOptions.includes("u")&&regexOptions.includes("v")))throw new SnippetLimitError("Invalid snippet transform descriptor");
        transform.regexSource=regexValue;transform.regexFlags=regexOptions; catch (e) {
			// invalid regexp
			return false;
		}

		parent.transform = transform;
		return true;
	}

	private _parseFormatString(parent: Transform): boolean {

		const token = this._token;
		if (!this._accept(TokenType.Dollar)) {
			return false;
		}

		let complex = false;
		if (this._accept(TokenType.CurlyOpen)) {
			complex = true;
		}

		const index = this._accept(TokenType.Int, true);

		if (!index) {
			this._backTo(token);
			return false;

		} else if (!complex) {
			// $1
			parent.appendChild(new FormatString(this.budget, Number(index)));
			return true;

		} else if (this._accept(TokenType.CurlyClose)) {
			// ${1}
			parent.appendChild(new FormatString(this.budget, Number(index)));
			return true;

		} else if (!this._accept(TokenType.Colon)) {
			this._backTo(token);
			return false;
		}

		if (this._accept(TokenType.Forwardslash)) {
			// ${1:/upcase}
			const shorthand = this._accept(TokenType.VariableName, true);
			if (!shorthand || !this._accept(TokenType.CurlyClose)) {
				this._backTo(token);
				return false;
			} else {
				parent.appendChild(new FormatString(this.budget, Number(index), shorthand));
				return true;
			}

		} else if (this._accept(TokenType.Plus)) {
			// ${1:+<if>}
			const ifValue = this._until(TokenType.CurlyClose);
			if (ifValue) {
				parent.appendChild(new FormatString(this.budget, Number(index), undefined, ifValue, undefined));
				return true;
			}

		} else if (this._accept(TokenType.Dash)) {
			// ${2:-<else>}
			const elseValue = this._until(TokenType.CurlyClose);
			if (elseValue) {
				parent.appendChild(new FormatString(this.budget, Number(index), undefined, undefined, elseValue));
				return true;
			}

		} else if (this._accept(TokenType.QuestionMark)) {
			// ${2:?<if>:<else>}
			const ifValue = this._until(TokenType.Colon);
			if (ifValue) {
				const elseValue = this._until(TokenType.CurlyClose);
				if (elseValue) {
					parent.appendChild(new FormatString(this.budget, Number(index), undefined, ifValue, elseValue));
					return true;
				}
			}

		} else {
			// ${1:<else>}
			const elseValue = this._until(TokenType.CurlyClose);
			if (elseValue) {
				parent.appendChild(new FormatString(this.budget, Number(index), undefined, undefined, elseValue));
				return true;
			}
		}

		this._backTo(token);
		return false;
	}

	private _parseAnything(marker: Marker): boolean {
		if(this._token.type===TokenType.Dollar&&this._scanner.value[this._token.pos+1]==="{")throw new Error("Malformed snippet construct");
        if (this._token.type !== TokenType.EOF) {
			marker.appendChild(new Text(this.budget, this._scanner.tokenText(this._token)));
			this._accept(undefined);
			return true;
		}
		return false;
	}
}
