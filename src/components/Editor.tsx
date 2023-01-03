import { Editable, Slate, withReact, ReactEditor, DefaultElement, RenderElementProps, RenderLeafProps } from "slate-react";
import { isKeyHotkey } from "is-hotkey";
import { createEditor, Descendant, BaseEditor, Range, Transforms, Node, Path, Editor as SlateEditor } from "slate";
import { useCallback, useMemo, useState } from "react";
import { withHistory } from 'slate-history';

import React from "react";

// lets model a json according to ECMA-404:
type JsonObject = {
    type: 'JsonObject',
    children: (JsonSyntax | JsonMember)[],
};

type JsonArray = {
    type: 'JsonArray',
    children: JsonValue[],
};

type JsonMember = {
    type: 'JsonMember',
    children: (JsonSyntax | JsonKey | JsonValue)[]
};

type JsonKey = {
    type: 'JsonKey',
    text: string,
    //children: { text: string }[]
};

type JsonString = {
    type: 'JsonString',
    children: (JsonSyntax | { text: string })[],
    isJsonUnescaped?: boolean, // the text is already "unescaped" (so not in JSON 'foo\"bla' but 'foo"bla')
};

type JsonValue = JsonObject | JsonArray | JsonString | { type: 'JsonNumber', children: { text: string }[] } | { type: 'JsonBool', children: { text: string }[] /* true false null */ };

type JsonSyntax = {
    type: 'JsonSyntax',
    text: string,
}

type JsonDoc = {
    type: 'JsonDoc',
    children: (JsonSyntax | JsonValue | JsonMember)[]
};

declare module 'slate' {
    interface CustomTypes {
        Editor: BaseEditor & ReactEditor
        Element: JsonDoc | JsonValue | JsonMember | JsonKey,
        Text: { text: string, type?: string }
    }
}

const isEmpty = (d: Descendant) => {
    console.log(`isValidJson(${JSON.stringify(d)})...`);
    if ('type' in d) {
        return d.type === 'JsonSyntax' && (d.text.length === 0);
    } else {
        if ('text' in d && (d as any).text === '') { return true } else { return false; }
    }
};

export const isValidJson = (d: Descendant) => {
    console.log(`isValidJson(${JSON.stringify(d)})...`);
    let toRet = false;
    switch (d.type) {
        case 'JsonBool':
            if ('children' in d && d.children.length === 1) {
                toRet = ['true', 'false', 'null'].includes(d.children[0].text);
            }
            break;
        case 'JsonNumber':
            if ('children' in d && d.children.length === 1) {
                toRet = (/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g).test(d.children[0].text);
            }
            break;
        case 'JsonString':
            if ('children' in d && d.children.length === 3) {
                const c1 = d.children[0];
                const c2 = d.children[1];
                const c3 = d.children[2];
                const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text === '"';
                const c3Valid = 'type' in c3 && c3.type === 'JsonSyntax' && c3.text === '"';
                const c2Valid = !('type' in c2);
                return c1Valid && c2Valid && c3Valid;
            }
            break;
        case 'JsonDoc': {
            // check that there is a single valid member
            // ignore empty text or JsonSyntax
            let nrValid = 0;
            let nrInvalid = 0;

            for (const child of (d as JsonDoc).children) {
                if (isEmpty(child as Descendant)) continue;
                if (isValidJson(child as Descendant)) { nrValid++; } else { nrInvalid++; }
            }
            console.log(`isValidJson(JsonDoc) nrInvalid=${nrInvalid} nrValid=${nrValid}`);
            toRet = nrInvalid === 0 && nrValid <= 1;
        }
            break;
        case 'JsonSyntax':
            toRet = d.text === '';
            break;
        default:
    }
    console.log(`isValidJson(${JSON.stringify(d)})=${toRet}`);
    return toRet;
};

const normalizeJsonSyntax = (editor: ReactEditor, path: Path, text: string, textAfterCol: string) => {
    const isTrue = textAfterCol.toLowerCase().startsWith("true".slice(0, textAfterCol.length));
    const isFalse = !isTrue && textAfterCol.toLowerCase().startsWith("false".slice(0, textAfterCol.length));
    const isNull = !isTrue && !isFalse && textAfterCol.toLowerCase().startsWith("null".slice(0, textAfterCol.length));
    if (isTrue || isFalse || isNull) {
        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected bool from '${textAfterCol}'`);
        const newText = JSON.stringify(isNull ? null : isTrue);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { type: 'JsonBool', children: [{ text: newText }] }, { at: Path.next(path) });
        });
        const pathNext = Path.next(path).concat([0]);
        console.log(`withJsonElements.normalizeNode: rule #3: going to select ${pathNext}:1-${newText.length}`);
        Transforms.select(editor, { anchor: { path: pathNext, offset: 1 }, focus: { path: pathNext, offset: newText.length } });
        return true;
    } else if (textAfterCol === '"') {
        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected string from '${textAfterCol}'`);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { type: 'JsonString', children: [{ type: 'JsonSyntax', text: '"' }, { text: "string" }, { type: 'JsonSyntax', text: '"' }] }, { at: Path.next(path) });
        });
        const anchor = { path: Path.next(path).concat([1]), offset: 0 };
        const focus = { path: Path.next(path).concat([2]), offset: 1 };
        console.log(`withJsonElements.normalizeNode: rule #3: going to select ${anchor}-${focus}:0-6`);
        Transforms.select(editor, { anchor, focus });
        return true;
    } else if (textAfterCol === '{') {
        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected object from '${textAfterCol}'`);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { 'type': 'JsonObject', children: [{ type: 'JsonSyntax', text: '{' }, { type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }, { type: 'JsonSyntax', text: '}' }] }, { at: Path.next(path) });
        });
        const pathNext = Path.next(path).concat([1, 1]);
        console.log(`withJsonElements.normalizeNode: rule #3: going to select ${pathNext}:0-3`);
        Transforms.select(editor, { anchor: { path: pathNext, offset: 0 }, focus: { path: pathNext, offset: 3 } });
        return true;
    } else if (textAfterCol.startsWith('-') || (/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g).test(textAfterCol)) {
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { type: 'JsonNumber', children: [{ text: textAfterCol }] }, { at: Path.next(path) });
        });
        const pathNext = Path.next(path).concat([0]);
        Transforms.select(editor, { anchor: { path: pathNext, offset: 1 }, focus: { path: pathNext, offset: textAfterCol.length } });

        return true;
    }
    return false;
};

const withJsonElements = (editor: ReactEditor) => {
    const { normalizeNode, isInline } = editor;

    // Editor: top level node
    // Elements: nodes with children
    // Block: by default all elements. override by .isInline function. So blocks != inlines

    // rules: 
    // 1. All elements must contain at least one Text descendant
    //  if not -> empty text element will be added as child
    // 2. two adj texts with the same custom properties will be merged
    // 3. block nodes (!= (inline or text)) can only contain other blocks, or inline and text nodes (so either blocks or (inline and texts)) (-> will be removed)
    // 4. inline nodes cannot be the first or the last child of a parent block, nor can it be next to another inline node in the child array (-> empty text node will be added)
    // 5. top level editor node can only contain block nodes

    editor.normalizeNode = ([node, path]) => {
        const type = 'type' in node ? node.type : undefined;
        console.log(`withJsonElements.normalizeNode(node.type=${type} path=${JSON.stringify(path)}) text=${Node.string(node).slice(0, 20)}...`);

        const parent = path.length > 0 ? Node.parent(editor, path) : undefined;
        const parentType = parent && 'type' in parent ? parent.type : undefined;
        // rules:
        // #1 use case: "adding members to an object starting after a member with ,"
        if (type === 'JsonSyntax' && parentType === 'JsonMember') {
            const text = Node.string(node);
            let matches;
            if (text.match(/^\s*,\s*$/g)) {
                console.log(`withJsonElements.normalizeNode: rule #1: text='${text}'`);
                SlateEditor.withoutNormalizing(editor, () => {
                    // setNodes skips children and text: Transforms.setNodes(editor, { text: 'foo' }, { at: path }); // this one with empty text
                    Transforms.delete(editor, { at: path });
                    Transforms.insertNodes(editor, { type: 'JsonSyntax', text: ',' }, { at: Path.next(Path.parent(path)) });
                    Transforms.move(editor, { distance: 1 });
                });
                return;
                // #3 use case: "adding value to an member starting after the :""
            } else if ((matches = (/^\s*"\s*:\s*(\S+)/g).exec(text))) {
                const textAfterCol = matches[1];
                console.log(`withJsonElements.normalizeNode: rule #3: text='${text}' matches[1]=${textAfterCol}`);
                // only if this JsonSyntax is the last child of the JSONMember (otherwise we do have a value yet)
                const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
                if (isLast) {
                    // determine the type of value:
                    // starting with: t -> Bool: true
                    // starting with: f -> Bool: false
                    // starting with: n -> Bool: null
                    // starting with: " -> String
                    // starting with: { -> Object
                    // starting with: [ -> Array
                    console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol='${textAfterCol}' isLast=${isLast}`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterCol)) { return; }
                    /*
                    const isTrue = textAfterCol.toLowerCase().startsWith("true".slice(0, textAfterCol.length));
                    const isFalse = !isTrue && textAfterCol.toLowerCase().startsWith("false".slice(0, textAfterCol.length));
                    const isNull = !isTrue && !isFalse && textAfterCol.toLowerCase().startsWith("null".slice(0, textAfterCol.length));
                    if (isTrue || isFalse || isNull) {
                        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected bool from '${textAfterCol}'`);
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
                            Transforms.insertNodes(editor, { type: 'JsonBool', children: [{ text: JSON.stringify(isNull ? null : isTrue) }] }, { at: Path.next(path) });
                        });
                    } else if (textAfterCol === '"') {
                        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected string from '${textAfterCol}'`);
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
                            Transforms.insertNodes(editor, { type: 'JsonString', children: [{ type: 'JsonSyntax', text: '"' }, { text: "string" }, { type: 'JsonSyntax', text: '"' }] }, { at: Path.next(path) });
                        });
                        const pathNext = Path.next(path).concat([1]);
                        console.log(`withJsonElements.normalizeNode: rule #3: going to select ${pathNext}:0-6`);
                        Transforms.select(editor, { anchor: { path: pathNext, offset: 0 }, focus: { path: pathNext, offset: 6 } });
                    } else if (textAfterCol === '{') {
                        console.log(`withJsonElements.normalizeNode: rule #3: textAfterCol detected object from '${textAfterCol}'`);
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
                            Transforms.insertNodes(editor, { 'type': 'JsonObject', children: [{ type: 'JsonSyntax', text: '{' }, { type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }, { type: 'JsonSyntax', text: '}' }] }, { at: Path.next(path) });
                        });
                        const pathNext = Path.next(path).concat([1, 1]);
                        console.log(`withJsonElements.normalizeNode: rule #3: going to select ${pathNext}:0-3`);
                        Transforms.select(editor, { anchor: { path: pathNext, offset: 0 }, focus: { path: pathNext, offset: 3 } });
                    }*/
                } else {
                    console.warn(`withJsonElements.normalizeNode: rule #3: textAfterCol='${textAfterCol}' isLast=${isLast}: how to handle?`);
                    // overwrite if selected?
                }
            }
        }
        // #2 use case: "adding members to an object starting after a member with ,""
        if (type === 'JsonSyntax' && parentType === 'JsonObject') {
            const text = Node.string(node);
            if (text.match(/^\s*,\s*"/g)) {
                console.log(`withJsonElements.normalizeNode: rule #2: text='${text}'`);
                SlateEditor.withoutNormalizing(editor, () => {
                    Transforms.delete(editor, { at: { anchor: { path, offset: text.indexOf(',') }, focus: { path: path, offset: text.indexOf('"') + 1 } } });
                    // todo if at start or at the end don't enter the JsonSyntax:,
                    Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: ',' }, { type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }, { type: 'JsonSyntax', text: ',' }], { at: path });
                });
                const pathNext = Path.next(path).concat([1]);
                console.log(`withJsonElements.normalizeNode: rule #2: going to select ${pathNext}:0-3`);
                Transforms.select(editor, { anchor: { path: pathNext, offset: 0 }, focus: { path: pathNext, offset: 3 } });
                return;
            }
        }
        // #4 like #2 but at start of an object after the {
        // todo

        // #5 use case empty doc
        if (type === 'JsonSyntax' && parentType === 'JsonDoc') {
            const isFirst = Path.equals(path, Node.first(editor, Path.parent(path))[1]);
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            if (isFirst && isLast) { // single member yet
                const text = Node.string(node);
                console.log(`withJsonElements.normalizeNode: rule #5: text='${text}'`);
                let matches;
                if ((matches = (/^\s*(\S+)/g).exec(text))) {
                    const textAfterWs = matches[1];
                    console.log(`withJsonElements.normalizeNode: rule #5: textAfterWs='${textAfterWs}'`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterWs)) { return; }
                }
            } else {
                console.log(`withJsonElements.normalizeNode: rule #5: text='${Node.string(node)}' isFirst=${isFirst} isLast=${isLast}`);
            }
        }
        if (type === undefined && parentType === 'JsonDoc') {
            const isFirst = Path.equals(path, Node.first(editor, Path.parent(path))[1]);
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            // convert into JsonSyntax:
            if (isFirst && isLast) {
                console.log(`withJsonElements.normalizeNode: rule #5.2: converted into JsonSyntax: text='${Node.string(node)}'`);
                Transforms.setNodes(editor, { type: 'JsonSyntax' }, { at: path });
                return;
            } else {
                console.log(`withJsonElements.normalizeNode: rule #5.2: text='${Node.string(node)}' isFirst=${isFirst} isLast=${isLast}`, Node.get(editor, Path.parent(path)));
            }
        }

        // #6 JsonString check for text ending with " and no trailing JsonSyntax
        if (type === 'JsonString') {
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d && d.children.length === 2) {
                    const c1 = d.children[0];
                    const c2 = d.children[1];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text === '"';
                    const c2Valid = !('type' in c2);
                    if (c1Valid && c2Valid && c2.text.endsWith('"') && !c2.text.endsWith('\\"')) {
                        const text = Node.string(node);
                        console.log(`withJsonElements.normalizeNode: rule #6: text='${text}'`);
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.setNodes(editor, { isJsonUnescaped: true }, { at: path });
                            const unescaped = JSON.parse('"' + c2.text);
                            Transforms.insertText(editor, unescaped, { at: { anchor: { path: path.concat([1]), offset: 0 }, focus: { path: path.concat([1]), offset: 0 } } });
                            Transforms.delete(editor, { at: { anchor: { path: path.concat([1]), offset: unescaped.length }, focus: { path: path.concat([1]), offset: unescaped.length + c2.text.length } } });
                            // Transforms.delete(editor, { at: { anchor: { path: path.concat([1]), offset: c2.text.length - 1 }, focus: { path: path.concat([1]), offset: c2.text.length } } });
                            Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: '"' }], { at: path.concat([2]) });
                            Transforms.move(editor, { distance: 1 });
                        });
                        return;
                    }
                }
            }
        }

        // #1 if type is empty and text ends with ',' and parent.type == JsonMember -> change into 'JsonSyntax', text ',' and add new JsonMember with children JsonSyntax :''
        /*        if (path.length > 0 && type === undefined) {
                const text = Node.string(node);
                if (text.match(/^\s*,\s*$/g)) {
                    const parent = Node.parent(editor, path);
                    if ('type' in parent && parent.type === 'JsonMember') {
                        console.log(`withJsonElements.normalizeNode: rule #1old: text='${text}'`);
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.setNodes(editor, { text: 'foo' }, { at: path }); // this one with empty text
                            Transforms.insertNodes(editor, { type: 'JsonSyntax', text: ',' }, { at: Path.next(Path.parent(path)) });
                            // todo set selection...
                        });
                        return;
                    }
                }
            }*/
        // #2 if type JsonSyntax member of JsonMember and text ends with ',"' -> split into JsonMem 
        //if (type === 'JsonSyntax')
        // #3 if type JsonSyntax member of JsonString...
        // #4 JsonString ^".*",$ -> , as sep.

        return normalizeNode([node, path]);
    }

    editor.isInline = (element: JsonDoc | JsonValue | JsonMember | JsonKey) => {
        if (['JsonBool', 'JsonNumber', 'JsonKey', 'JsonString', 'JsonMember', 'JsonObject', 'JsonArray'].includes(element.type)) return true;
        return isInline(element);
    }
    return editor;
};

/*
const ExampleDocument: Descendant[] = [
    {
        type: 'JsonBool',
        text: 'false'
    }
];*/

const desValue = (value: any): JsonValue | undefined => {
    // needs at least one child with text...
    if (value === undefined) return undefined;
    // todo null...
    switch (typeof value) {
        case 'string':
            return { type: 'JsonString', children: [{ type: 'JsonSyntax', text: '"' }, { text: value }, { type: 'JsonSyntax', text: '"' }] }
        case 'boolean':
            return { type: 'JsonBool', children: [{ text: JSON.stringify(value) }] }
        case 'bigint':
        case 'number':
            return { type: 'JsonNumber', children: [{ text: JSON.stringify(value) }] }
        case 'object':
            let newE: JsonObject = { 'type': 'JsonObject', children: [{ type: 'JsonSyntax', text: '{' }] };
            Object.keys(value).forEach((key, index) => {
                const v = desValue(value[key]);
                if (v !== undefined) {
                    if (index > 0) {
                        newE.children.push({ type: 'JsonSyntax', text: ',' });
                    }
                    newE.children.push({ type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: key }, { type: 'JsonSyntax', text: '":' }, v, { type: 'JsonSyntax', text: '' }] });
                }
            });
            newE.children.push({ type: 'JsonSyntax', text: '}' });
            return newE;
        // todo Array
        default:
            return { type: 'JsonBool', children: [{ text: 'null' }] }
    };
}

const deserialize = (obj: any): (Descendant)[] => {
    console.log(`deserialize(${JSON.stringify(obj)})...`);
    const desVal = desValue(obj);
    if (desVal !== undefined) {
        if (!isValidJson(desVal)) {
            console.assert(false, `no valid json! ${JSON.stringify(desVal)}`)
        }
        return [{ type: 'JsonDoc', children: [{ type: 'JsonSyntax', text: '' }, desVal, { type: 'JsonSyntax', text: '' }] }]; // rule 5: top level editor node can only contain block nodes
    } else {
        return [{ type: 'JsonDoc', children: [{ type: 'JsonSyntax', text: '' }] }]; // rule 5: top level editor node can only contain block nodes
    }
}

const serValue = (d: Descendant) => {
    switch (d.type) {
        case 'JsonBool': {
            // toRet = ['true', 'false', 'null'].includes(d.children[0].text);
            switch ((d as any).children[0].text.toLowerCase()) {
                case 'true': return true;
                case 'false': return false;
                case 'null': return null;
            }
            return undefined;
        }
        case 'JsonString': {
            if ('children' in d && d.children.length === 3) {
                const c1 = d.children[0];
                const c2 = d.children[1];
                const c3 = d.children[2];
                const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text === '"';
                const c3Valid = 'type' in c3 && c3.type === 'JsonSyntax' && c3.text === '"';
                const c2Valid = !('type' in c2);
                if (!c1Valid && c2Valid && c3Valid) return undefined;
                return d.isJsonUnescaped ? c2.text : JSON.parse(c1.text + c2.text + c3.text);
            } else return undefined;
        }
        case 'JsonNumber': {
            if ('children' in d && d.children.length === 1) {
                return Number(d.children[0].text);
            }
            return undefined
        }
    }
}

export const serialize = (value: Descendant[]) => {
    console.log(`serialize(value=${JSON.stringify(value)})...`);
    if (value === undefined) return undefined;
    if (value.length !== 1) return undefined;
    try {
        const d = value[0];
        if (!isValidJson(d)) return undefined;
        if (d.type !== 'JsonDoc') return undefined;
        for (const child of (d as JsonDoc).children) {
            if (isEmpty(child as Descendant)) continue;
            if (isValidJson(child as Descendant)) {
                return serValue(child);
            } else { console.assert(false); }
        }
    } catch (e) {
        console.error(`serialize got e=${e}`)
    }
    return undefined;
};

export default function Editor({ object, onChange, getEditor }: { object: any, onChange?: ((v: any) => void), getEditor?: (ed: ReactEditor) => void }) {
    const editor = useMemo(() => withJsonElements(withHistory(withReact(createEditor()))), []);
    const [document, setDocument] = useState(deserialize(object));

    if (getEditor) { getEditor(editor); }

    const renderElement = useCallback((props: RenderElementProps) => {
        switch (props.element.type) {
            case 'JsonObject':
                //console.log(`renderElement JsonObject called`, props.element.children[0].children[0]);
                // <div contentEditable={false} style={{ userSelect: "none" }}>{'}'}</div>
                return (<pre style={{ backgroundColor: 'lightgrey' }}{...props.attributes}><code>{props.children}</code></pre >);
            case 'JsonMember':
                return (<span style={{ backgroundColor: 'lightgreen' }}{...props.attributes}>{props.children}</span >);
            case 'JsonKey':
                return (<span style={{ backgroundColor: 'lightred' }}{...props.attributes}>{props.children}</span>);
            case 'JsonBool':
                return (<span style={{ backgroundColor: 'darkgrey' }}{...props.attributes}>{props.children}</span>);
            case 'JsonString':
                return (<span style={{ backgroundColor: 'lightblue' }}{...props.attributes}>{props.children}</span>);
            default:
                //console.log(`renderElement ${props.element.type}...`);
                return <DefaultElement {...props} />
        }
    }, []);

    const renderLeaf = useCallback(({ attributes, children, leaf }: RenderLeafProps) => {
        let el = <>{children}</>;
        if ('type' in leaf) {
            switch (leaf.type) {
                case 'JsonKey': el = <strong>{el}</strong>; break;
                case 'JsonValue': el = <em>{el}</em>; break;
                case 'JsonString': break;
                default: el = <u>{el}</u>; break;
            }
        } else {
            return <span {...attributes}>{el}</span >;
        }

        return <span {...attributes} title={'' + leaf.type}>{el}</span >;
    }, []);

    const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = event => {
        const { selection } = editor
        // Default left/right behavior is unit:'character'.
        // This fails to distinguish between two cursor positions, such as
        // <inline>foo<cursor/></inline> vs <inline>foo</inline><cursor/>.
        // Here we modify the behavior to unit:'offset'.
        // This lets the user step into and out of the inline without stepping over characters.
        // You may wish to customize this further to only use unit:'offset' in specific cases.
        if (selection && Range.isCollapsed(selection)) {
            const { nativeEvent } = event
            if (isKeyHotkey('left', nativeEvent)) {
                //console.log(`onKeyDown(left)...`, selection);
                event.preventDefault()
                Transforms.move(editor, { unit: 'offset', reverse: true })
                return
            }
            if (isKeyHotkey('right', nativeEvent)) {
                //console.log(`onKeyDown(right)...path=${selection.anchor.path.join('/')}:${selection.anchor.offset}`);
                event.preventDefault()
                Transforms.move(editor, { unit: 'offset' })
                return
            }
        }
    }

    return (
        <Slate editor={editor} value={document} /*onChange={value => { console.log('onChange...'); setDocument(value); const serialized = serialize(value); if (serialized !== undefined) { onChange(serialized); } }}*/>
            <Editable
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                onKeyDown={onKeyDown}
            />
        </Slate>
    );
}