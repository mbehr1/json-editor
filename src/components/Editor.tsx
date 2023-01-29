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
    children: (JsonSyntax | JsonValue)[],
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

const isEmpty = (d: Descendant): boolean => {
    //console.log(`isEmpty(${JSON.stringify(d)})...`);
    if ('type' in d) {
        return d.type === 'JsonSyntax' && (d.text.length === 0);
    } else {
        if ('text' in d && (d as any).text.length === 0) { return true } else { return false; }
    }
};

export const isValidMember = (d: JsonMember): boolean => {
    if (d.children.length === 5) { // Syntax ", Key, Syntax ":, Value, Syntax: ""
        const c1 = d.children[0];
        const c2 = d.children[1];
        const c3 = d.children[2];
        const c5 = d.children[4];
        const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text === '"';
        const c2Valid = 'type' in c3 && c2.type === 'JsonKey' && c2.text.length > 0;
        const c3Valid = 'type' in c3 && c3.type === 'JsonSyntax' && c3.text === '":';
        const c5Valid = 'text' in c5 && c5.text.length === 0;
        // console.log(`isValidMember(${JSON.stringify(d)})...valid=${[c1Valid, c2Valid, c3Valid, c5Valid]} `);
        return c1Valid && c2Valid && c3Valid && c5Valid && isValidJson(d.children[3]);
    }
    return false;
}

export const isValidJson = (d: Descendant): boolean => {
    //console.log(`isValidJson(${JSON.stringify(d)})...`);
    let toRet = false;
    switch (d.type) {
        case 'JsonBool':
            if ('children' in d && d.children.length === 1) {
                toRet = ['true', 'false', 'null'].includes(d.children[0].text);
            }
            break;
        case 'JsonNumber':
            if ('children' in d && d.children.length === 1) {
                toRet = (/^\s*-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\s*$/g).test(d.children[0].text);
            }
            break;
        case 'JsonString':
            if ('children' in d) {
                if (d.children.length === 3) {
                    const c1 = d.children[0];
                    const c2 = d.children[1];
                    const c3 = d.children[2];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text.trimStart() === '"';
                    const c3Valid = 'type' in c3 && c3.type === 'JsonSyntax' && c3.text.trimEnd() === '"';
                    const c2Valid = !('type' in c2);
                    toRet = c1Valid && c2Valid && c3Valid;
                } else if (d.children.length === 1) { // special case for e.g. empty string
                    const c1 = d.children[0];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text.trim() === '""';
                    toRet = c1Valid;
                }
            }
            break;
        case 'JsonObject':
            // special case: empty object -> single JsonSyntax with text {}
            if ('children' in d && d.children.length === 1) {
                const c1 = d.children[0];
                const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && /^\s*{\s*}\s*$/.test(c1.text);
                toRet = c1Valid;
            } else
                // we expect the first and last to be a JsonSyntax with text {,}
                if ('children' in d && d.children.length >= 2) {
                    const c1 = d.children[0];
                    const cl = d.children[d.children.length - 1];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text.trim() === '{';
                    const clValid = 'type' in cl && cl.type === 'JsonSyntax' && cl.text.trim() === '}';
                    // console.log(`isValidJson(JsonObject: ${JSON.stringify(d)})...c1Valid=${c1Valid} clValid=${clValid}`);
                    if (c1Valid && clValid) {
                        // all children valid?
                        const nrMembers = d.children.length - 2;
                        // console.log(`isValidJson(JsonObject: ${JSON.stringify(d)})...nrMembers=${nrMembers}`);
                        if (nrMembers === 0) {
                            toRet = true;
                        } else {
                            // iterate:
                            let allValid = true;
                            for (let i = 1; i < d.children.length - 1; ++i) { // all but first, last
                                const c = d.children[i];
                                let cValid = false;
                                if (i % 2 === 1) { // expect JsonMember
                                    cValid = 'type' in c && c.type === 'JsonMember' && isValidMember(c);
                                } else { // expect JsonSyntax ,
                                    cValid = 'type' in c && c.type === 'JsonSyntax' && c.text.trim() === ',';
                                }
                                if (!cValid) {
                                    allValid = false;
                                    break;
                                }
                            }
                            toRet = allValid;
                        }
                    }
                }
            break;
        case 'JsonArray':
            if ('children' in d) {
                if (d.children.length === 1) {
                    const c1 = d.children[0];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && /^\s*\[\s*\]\s*$/.test(c1.text);
                    toRet = c1Valid;
                } else if (d.children.length >= 3) {
                    const c1 = d.children[0];
                    const cl = d.children[d.children.length - 1];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text.trim() === '[';
                    const clValid = 'type' in cl && cl.type === 'JsonSyntax' && cl.text.trim() === ']';
                    if (c1Valid && clValid) {
                        const nrMembers = d.children.length - 2;
                        if (nrMembers === 0) {
                            toRet = true;
                        } else { // nrMembers>=1
                            let allValid = true;
                            for (let i = 1; i < d.children.length - 1; ++i) { // all but first, last
                                const c = d.children[i];
                                let cValid = false;
                                if (i % 2 === 1) { // expect JsonValue
                                    cValid = 'type' in c && c.type !== 'JsonSyntax' && isValidJson(c);
                                } else { // expect JsonSyntax ,
                                    cValid = 'type' in c && c.type === 'JsonSyntax' && c.text.trim() === ',';
                                }
                                if (!cValid) {
                                    allValid = false;
                                    break;
                                }
                            }
                            toRet = allValid;
                        }
                    }
                }
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
            // console.log(`isValidJson(JsonDoc) nrInvalid=${nrInvalid} nrValid=${nrValid}`);
            toRet = nrInvalid === 0 && nrValid <= 1;
        }
            break;
        case 'JsonSyntax':
            toRet = d.text.trim() === '';
            break;
        default:
    }
    // if (!toRet) console.log(`isValidJson(${JSON.stringify(d, undefined, 2)})=${toRet}`);
    return toRet;
};

const normalizeJsonSyntax = (editor: ReactEditor, path: Path, text: string, textAfterCol: string, insertEmptyJsonSyntax?: boolean, insertNewAtPath?: Path) => {
    const isTrue = textAfterCol.toLowerCase().startsWith("true".slice(0, textAfterCol.length));
    const isFalse = !isTrue && textAfterCol.toLowerCase().startsWith("false".slice(0, textAfterCol.length));
    const isNull = !isTrue && !isFalse && textAfterCol.toLowerCase().startsWith("null".slice(0, textAfterCol.length));
    const insertAt = insertNewAtPath !== undefined ? insertNewAtPath : Path.next(path);
    if (isTrue || isFalse || isNull) {
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: textAfterCol detected bool from '${textAfterCol}'`);
        const newText = JSON.stringify(isNull ? null : isTrue);
        let toSelStartOffset=textAfterCol.length;
        const newNodes: Node[] = [{ type: 'JsonBool', children: [{ text: newText }] }];
        if (textAfterCol.length>newText.length){
            newNodes.push({type:'JsonSyntax', text: textAfterCol.slice(newText.length)});
            toSelStartOffset = newText.length;
        }
            if (insertEmptyJsonSyntax) {
                newNodes.push({ type: 'JsonSyntax', text: "" });
            }
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { anchor:{path, offset: text.length - textAfterCol.length},focus:{path, offset:text.length} } });
            Transforms.insertNodes(editor, newNodes, { at: insertAt });
        });
        const pathNext = insertAt.concat([0]);
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: going to select ${pathNext}:${toSelStartOffset}-${newText.length}`);
        Transforms.select(editor, { anchor: { path: pathNext, offset: toSelStartOffset }, focus: { path: pathNext, offset: newText.length } });
        return true;
    } else if (textAfterCol.startsWith('"')) {
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: textAfterCol detected string from '${textAfterCol}'`);
        const newNodes: Node[] = [{ type: 'JsonString', isJsonUnescaped: true, children: [{ type: 'JsonSyntax', text: '"' }, { text: "string" }, { type: 'JsonSyntax', text: '"' }] }];
        if (textAfterCol.length>1){
            newNodes.push({type:'JsonSyntax', text: textAfterCol.slice(1)});
        }
        SlateEditor.withoutNormalizing(editor, () => {
            //Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.delete(editor, { at: {anchor:{path, offset: text.length - textAfterCol.length },focus:{path, offset:text.length} }});
            Transforms.insertNodes(editor,newNodes, { at: insertAt });
        });
        const anchor = { path: insertAt.concat([1]), offset: 0 };
        const focus = { path: insertAt.concat([2]), offset: 1 };
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
        Transforms.select(editor, { anchor, focus });
        return true;
    } else if (textAfterCol === '{') {
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: textAfterCol detected object from '${textAfterCol}'`);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { 'type': 'JsonObject', children: [{ type: 'JsonSyntax', text: '{' }, { type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }, { type: 'JsonSyntax', text: '}' }] }, { at: insertAt });
        });
        const anchor = { path: insertAt.concat([1, 0]), offset: 0 };
        const focus = { path: insertAt.concat([2]), offset: 1 };
        //console.log(`withJsonElements.normalizeJsonSyntax: rule #3: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
        //const pathNext = Path.next(path).concat([1, 1]);
        Transforms.select(editor, { anchor, focus });
        return true;
    } else if (textAfterCol === '[') {
        console.log(`withJsonElements.normalizeJsonSyntax: rule #3: textAfterCol detected array from '${textAfterCol}'`);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { path, offset: text.length - textAfterCol.length } });
            Transforms.insertNodes(editor, { 'type': 'JsonArray', children: [{ type: 'JsonSyntax', text: '[]' }] }, { at: insertAt });
        });
        const anchor = { path: insertAt.concat([0]), offset: 1 };
        const focus = { path: insertAt.concat([0]), offset: 2 };
        Transforms.select(editor, { anchor, focus });
        return true;

    } else if (textAfterCol.startsWith('-') || (/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g).test(textAfterCol)) {
        console.log(`withJsonElements.normalizeJsonSyntax: detected number. Deleting: ${text.slice(text.length - textAfterCol.length)}`);
        console.log(`withJsonElements.normalizeJsonSyntax: detected number. Inserting: ${textAfterCol}`);
        SlateEditor.withoutNormalizing(editor, () => {
            Transforms.delete(editor, { at: { anchor: { path, offset: text.length - textAfterCol.length }, focus: { path, offset: text.length } } });
            Transforms.insertNodes(editor, { type: 'JsonNumber', children: [{ text: textAfterCol }] }, { at: insertAt });
            Transforms.move(editor, { distance: 1 });
        });
        //console.log(`withJsonElements.normalizeJsonSyntax: text.length=${text.length}, textAfterCol.length=${textAfterCol.length} textAfterCol='${textAfterCol}'`);

        return true;
    }
    return false;
};

const withJsonElements = (editor: ReactEditor) => {
    const { normalizeNode, isInline } = editor;

    editor.insertBreak = () => {
        console.log('insertBreak()...');
        return editor.insertText('\n');
        //return insertSoftBreak();
    }

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
        //console.log(`withJsonElements.normalizeNode(node.type=${type} path=${JSON.stringify(path)}) text=${Node.string(node).slice(0, 20)}...`);

        const parent = path.length > 0 ? Node.parent(editor, path) : undefined;
        const parentType = parent && 'type' in parent ? parent.type : undefined;
        // rules:
        // #11 array rules:
        if (type === 'JsonSyntax' && parentType === 'JsonArray') {
            const isFirst = Path.equals(path, Node.first(editor, Path.parent(path))[1]);
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            if (isFirst && isLast) { // single member yet
                const text = Node.string(node);
                console.log(`withJsonElements.normalizeNode: rule #11: text='${text}'`);
                let matches;
                if ((matches = (/^\s*\[\s*(\S+)$/g).exec(text))) {
                    const textAfterWs = matches[1];
                    console.log(`withJsonElements.normalizeNode: rule #11: textAfterWs='${textAfterWs}'`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterWs)) { return; }
                }
            } else if (isLast) {
                const text = Node.string(node);
                console.log(`withJsonElements.normalizeNode: rule #11.2: text='${text}'`);
                let matches;
                if ((matches = (/^\s*,\s*(\S+)$/g).exec(text))) {
                    const textAfterWs = matches[1];
                    console.log(`withJsonElements.normalizeNode: rule #11.2: textAfterWs='${textAfterWs}'`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterWs)) { return; }
                }
                //console.log(`withJsonElements.normalizeNode: rule #5: text='${Node.string(node)}' isFirst=${isFirst} isLast=${isLast}`);
            } else if (!isFirst) { // in the middle...
                // sometimes !isLast is wrong as there is a empty text being the last that will later be removed...
                const emptyText = parent && 'children' in parent && Array.isArray(parent.children) && parent.children.length > 0
                    && Node.string(Node.get(parent, [parent.children.length - 1])).trim().length === 0;

                if (!emptyText) { // we wait for next iteration
                    // JsonSyntax should be ws , ws
                    const text = Node.string(node);
                    // console.log(`withJsonElements.normalizeNode: rule #11.3: text='${text}'`);
                    if (!(/^\s*,\s*$/g).exec(text)) {
                        const matches = (/^\s*(.*?)\s*,\s*(.*?)\s*$/g).exec(text);
                        if (matches) {
                            const before = matches[1];
                            const after = matches[2];
                            const comPos = text.indexOf(',');
                            console.log(`withJsonElements.normalizeNode: rule #11.3: text='${text}' comPos=${comPos} before=${before} after=${after}`, matches, path);
                            // todo before...
                            if (before.length > 0) { console.error(`rule #11.3 before not empty. nyi!`); }
                            // move the text after to the next child
                            if (after.length) {
                                SlateEditor.withoutNormalizing(editor, () => {
                                    // setNodes skips children and text: Transforms.setNodes(editor, { text: 'foo' }, { at: path }); // this one with empty text
                                    Transforms.delete(editor, { at: { anchor: { path, offset: comPos + 1 }, focus: { path, offset: text.length } } });
                                    const nextPath = SlateEditor.leaf(editor, Path.next(path), { edge: 'start' })[1];
                                    Transforms.insertText(editor, after, { at: { anchor: { path: nextPath, offset: 0 }, focus: { path: nextPath, offset: 0 } } })
                                    Transforms.move(editor, { distance: 1 });
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }


        // #1 use case: "adding members to an object starting after a member with ,"
        if (type === 'JsonSyntax' && parentType === 'JsonMember') {
            const text = Node.string(node);
            let matches;
            if (text.match(/^\s*,\s*$/g)) { // ' , ' 
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
                    //const insertNewAtPath = Path.next(path);
                    console.log(`withJsonElements.normalizeNode: ${path} rule #3: textAfterCol='${textAfterCol}' isLast=${isLast}`);// insertNewAtPath=${insertNewAtPath}`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterCol /*, false, insertNewAtPath*/)) { return; }
                } else {
                    console.warn(`withJsonElements.normalizeNode: rule #3: textAfterCol='${textAfterCol}' isLast=${isLast}: how to handle?`);
                    // overwrite if selected?
                }
            } else if (text.match(/^\s*}\s*/g)) { // only closing bracket?
                const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]) || path[path.length - 1] >= 4;// fails sometimes if a text:"" was added automatically...;
                console.log(`withJsonElements.normalizeNode: ${path} rule #6: text='${text}' isLast=${isLast}`);
                if (isLast) {
                    const hasClosingBracket = Node.string(Node.descendant(editor, Path.next(Path.parent(path)))).trimStart().length > 0;
                    console.log(`withJsonElements.normalizeNode: rule #6: text='${text}' isLast=${isLast} hasClosingBracket=${hasClosingBracket}`);
                    if (!hasClosingBracket) {
                        // make this the closing bracket:
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: path });
                            Transforms.insertText(editor, "}", { at: Path.next(Path.parent(path)) });
                            Transforms.move(editor, { distance: 1 });
                        });
                        return;
                    }

                }
            }
        }
        // #2 use case: "adding members to an object starting after a member with ,""
        if (type === 'JsonSyntax' && parentType === 'JsonObject') {
            const text = Node.string(node);
            if (text.match(/^\s*,\s*"/g)) {
                console.log(`withJsonElements.normalizeNode: ${path} rule #2: text='${text}'`);
                SlateEditor.withoutNormalizing(editor, () => {
                    Transforms.delete(editor, { at: { anchor: { path, offset: text.indexOf(',') }, focus: { path: path, offset: text.indexOf('"') + 1 } } });
                    // todo if at start or at the end don't enter the JsonSyntax:,
                    Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: ',' }, { type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }, { type: 'JsonSyntax', text: '' }], { at: path });
                });
                const anchor = { path: Path.next(path).concat([1]), offset: 0 };
                const focus = { path: Path.next(path).concat([2]), offset: 2 };
                console.log(`withJsonElements.normalizeNode: rule #2: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
                Transforms.select(editor, { anchor, focus });
                return;
            }
        }
        // #4 like #2 but at start of an object after the {
        if (type === 'JsonSyntax' && parentType === 'JsonMember') {
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            if (isLast) { // and prev is not a JsonKey
                const isFirst = path[path.length-1] === 0;
                const prevNode = isFirst ? undefined : Node.get(editor, Path.previous(path));
                if (!(prevNode && 'type' in prevNode && prevNode.type === 'JsonKey')){
                const text = Node.string(node);
                if (text.match(/^\s*"\s*$/g)) {
                    console.log(`withJsonElements.normalizeNode:${path} rule #4.1: text='${text}'`);
                    SlateEditor.withoutNormalizing(editor, () => {
                        Transforms.insertNodes(editor, [{ type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }], { at: Path.next(path) });
                    });
                    const anchor = { path: Path.next(path), offset: 0 };
                    const focus = { path: Path.next(Path.next(path)), offset: 2 };
                    console.log(`withJsonElements.normalizeNode: rule #4.1: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
                    Transforms.select(editor, { anchor, focus });
                        return;
                    }
                }
            }
        }
        // #13 like #4 but with an empty JsonSyntax
        if (type === 'JsonSyntax' && parentType === 'JsonObject'){
            const isFirst = path[path.length-1] === 0;
            if (isFirst){
                const text = Node.string(node);
                if (text.match(/^\s*{\s*"/g)){
                    console.log(`withJsonElements.normalizeNode:${path} rule #13: text='${text}'`);
                    const textAfter = text.slice(text.indexOf('"')+1);
                    const newNodes: Node[] =  [{type: 'JsonMember', children:[{type: 'JsonSyntax', text:'"'},{ type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }]}];
                    if (textAfter.length>0){
                        newNodes.push({type: 'JsonSyntax', text: textAfter});
                    }
                    SlateEditor.withoutNormalizing(editor, ()=>{
                        Transforms.delete(editor, {at: {anchor: {path, offset: text.indexOf('"')}, focus:{path, offset: text.length}}});
                        Transforms.insertNodes(editor,newNodes, { at: Path.next(path) });
                        const anchor = { path: Path.next(path).concat([1]), offset: 0 };
                        const focus = { path: Path.next(path).concat([2]), offset: 2 };
                        Transforms.select(editor, { anchor, focus });
                    });
                    return;
                }
            }
        }

        if (type === 'JsonKey' && parentType === 'JsonMember') {
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            if (isLast) {
                const text = Node.string(node);
                if (text.match(/^\s*"\s*$/g)) {
                    console.log(`withJsonElements.normalizeNode: rule #4.3: text='${text}'`);
                    SlateEditor.withoutNormalizing(editor, () => {
                        Transforms.delete(editor, { at: { anchor: { path, offset: text.indexOf('"') }, focus: { path: path, offset: text.length } } });
                        Transforms.insertNodes(editor, [{ type: 'JsonMember', children: [{ type: 'JsonSyntax', text: '"' }, { type: 'JsonKey', text: 'key' }, { type: 'JsonSyntax', text: '":' }] }], { at: path });
                    });
                    //const anchor = { path: path.concat([1]), offset: 0 };
                    const anchor = { path: path, offset: text.indexOf('"') };
                    //const focus = { path: path.concat([2]), offset: 2 };
                    const focus = { path: Path.next(path), offset: 0 };
                    console.log(`withJsonElements.normalizeNode: rule #4.3: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
                    Transforms.select(editor, { anchor, focus });
                    return;
                }

                if (text.endsWith('"') && !text.endsWith('\\"')) {
                    const text = Node.string(node);
                    console.log(`withJsonElements.normalizeNode: rule #4.2: text='${text}'`);
                    SlateEditor.withoutNormalizing(editor, () => {
                        // Transforms.setNodes(editor, { isJsonUnescaped: true }, { at: path }); todo?
                        Transforms.delete(editor, { at: { anchor: { path, offset: text.length - 1 }, focus: { path: path, offset: text.length } } });
                        Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: '":' }], { at: Path.next(path) });
                        Transforms.move(editor, { distance: 1 });
                    });
                    const anchor = { path: Path.next(path), offset: 1 };
                    const focus = { path: Path.next(path), offset: 2 };
                    console.log(`withJsonElements.normalizeNode: rule #4.2: going to select ${JSON.stringify(anchor)}-${JSON.stringify(focus)}`);
                    Transforms.select(editor, { anchor, focus });
                    return;
                }

            }
        }

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
                    //console.log(`withJsonElements.normalizeNode: rule #5: textAfterWs='${textAfterWs}'`);
                    if (normalizeJsonSyntax(editor, path, text, textAfterWs)) { return; }
                }
            } else {
                //console.log(`withJsonElements.normalizeNode: rule #5: text='${Node.string(node)}' isFirst=${isFirst} isLast=${isLast}`);
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
                //console.log(`withJsonElements.normalizeNode: rule #5.2: text='${Node.string(node)}' isFirst=${isFirst} isLast=${isLast}`, Node.get(editor, Path.parent(path)));
            }
        }
        if (type === undefined && parentType === 'JsonMember') {
            const isFirst = Path.equals(path, Node.first(editor, Path.parent(path))[1]);
            const isLast = Path.equals(path, Node.last(editor, Path.parent(path))[1]);
            if (isFirst && isLast) { // single member yet
                const isEmpty = Node.string(node).trimStart().length === 0;
                if (isEmpty) {
                    // delete the full parent=JsonMember (as its empty)
                    Transforms.removeNodes(editor, { at: Path.parent(path) });
                    return;
                }
            }
        }

        // #6 JsonString check for text ending with " and no trailing JsonSyntax
        if (type === 'JsonString') {
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d) {
                    if (d.children.length === 2) {
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
                    } else if (d.children.length === 1) { // use-case chars behind "" or correction of single JsonSyntax: like "a" which fell into a single element
                        const text = Node.string(node);
                        if (text.length > 2) {
                            const startsProper = text.startsWith('"');
                            const endsProper = text.endsWith('"') && !text.endsWith('\\"');
                            if (startsProper && endsProper) {
                                // split into JsonSyntax ", text, JsonSyntax "
                                console.log(`withJsonElements.normalizeNode: rule #6.2: text='${text}'`);
                                SlateEditor.withoutNormalizing(editor, () => {
                                    Transforms.setNodes(editor, { isJsonUnescaped: true }, { at: path });
                                    const unescaped = JSON.parse('"' + text.slice(1, text.length - 1) + '"');
                                    Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: 1 }, focus: { path: path.concat([0]), offset: text.length } } });
                                    Transforms.insertNodes(editor, [{ text: unescaped }, { type: 'JsonSyntax', text: '"' }], { at: path.concat([1]) });
                                    Transforms.move(editor, { distance: unescaped.length + 1 });
                                });
                                return;
                            }
                            if (startsProper && text.startsWith('""')) { // chars after empty string
                                console.log(`withJsonElements.normalizeNode: rule #6.3: text='${text}'`);
                                // split the rest away
                                const expectedLength = 2;
                                SlateEditor.withoutNormalizing(editor, () => {
                                    Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: expectedLength }, focus: { path: path.concat([0]), offset: text.length } } })
                                    Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                                    Transforms.move(editor, { distance: expectedLength });
                                });
                                return;
                            }
                        }
                        if (text.trim().length===0){ // remove empty
                            console.log(`withJsonElements.normalizeNode: rule #6.4: text='${text}'`);
                            Transforms.removeNodes(editor, {at: path});
                            return;
                        }
                    } else if (d.children.length === 3) { // chars behind?
                        const c3 = d.children[2] as JsonSyntax;
                        const text = c3.text;
                        if (text.length > 1) {
                            console.log(`withJsonElements.normalizeNode: rule #6.4: text='${text}'`);
                            // split the rest away
                            const expectedLength = 1;
                            SlateEditor.withoutNormalizing(editor, () => {
                                Transforms.delete(editor, { at: { anchor: { path: path.concat([2]), offset: expectedLength }, focus: { path: path.concat([2]), offset: text.length } } })
                                Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                                Transforms.move(editor, {distance:1});
                            });
                            return;
                        }
                    }
                }
            }
        }

        if (type === 'JsonBool') {
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d && d.children.length === 1) {
                    // any chars behind?
                    const text = Node.string(node);
                    const isTrue = text.toLowerCase().startsWith("true");
                    const isFalse = !isTrue && text.toLowerCase().startsWith("false");
                    const isNull = !isTrue && !isFalse && text.toLowerCase().startsWith("null");
                    if (isTrue || isFalse || isNull) {
                        console.log(`withJsonElements.normalizeNode: rule #7: text='${text}'`);
                        // split the rest away
                        const expectedLength = isFalse ? 5 : 4;
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: expectedLength }, focus: { path: path.concat([0]), offset: text.length } } })
                            Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                            Transforms.move(editor, { distance: 1 });
                        });
                        return;
                    }else if (text.trim().length===0){ // remove empty bool
                        console.log(`withJsonElements.normalizeNode: rule #7.2: text='${text}'`);
                        Transforms.removeNodes(editor, {at: path});
                        return;
                    }
                }
            }
        }

        if (type === 'JsonNumber') {
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d && d.children.length === 1) {
                    const text = Node.string(node);
                    if (text.trim().length===0){ // remove empty
                        console.log(`withJsonElements.normalizeNode: rule #9.2: text='${text}'`);
                        Transforms.removeNodes(editor, {at: path});
                        return;
                    }
                    // any chars behind?
                    const match = (/([{},"[\]:]+)/g).exec(text);//const match = (/([{},"\[\]:]+)$/g).exec(text);
                    if (match && match.length > 0) {
                        const textAfter = match[1];
                        console.log(`withJsonElements.normalizeNode: rule #9: text='${text}' textAfter='${textAfter}'`);

                        // move the cursor only if it's currently after the expectedLength (where we do split)
                        console.log(`rule #9 selection collapsed=${editor.selection ? Range.isCollapsed(editor.selection) : false}`, editor.selection);
                        const oldOffset = editor.selection && Range.isCollapsed(editor.selection) ? editor.selection.anchor.offset : -1;

                        // split the rest away
                        const expectedLength = text.length - textAfter.length;
                        SlateEditor.withoutNormalizing(editor, () => {
                            Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: expectedLength }, focus: { path: path.concat([0]), offset: text.length } } })
                            Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                            if (oldOffset > expectedLength) { Transforms.move(editor, { distance: textAfter.length }); }
                        });
                        return;
                    }
                }
            }
        }

        if (type==='JsonArray'){ // todo besides the regex match=... this is same as JsonObject...
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d) {
                    if (d.children.length === 1) { // special case for empty array
                        const text = Node.string(node);
                        if (text.trim().length===0){ // remove empty
                            console.log(`withJsonElements.normalizeNode: rule #12.2: text='${text}'`);
                            Transforms.removeNodes(editor, {at: path});
                            return;
                        }
                        // any chars behind?
                        const match = (/^\s*\[\s*\]([{},"[\]:]+)$/g).exec(text); // const match = (/^\s*\[\s*\]([{},"\[\]:]+)$/g).exec(text);
                        if (match && match.length > 0) {
                            const textAfter = match[1];
                            console.log(`withJsonElements.normalizeNode: rule #12: text='${text}' textAfter='${textAfter}'`);
                            // split the rest away
                            const expectedLength = text.length - textAfter.length;
                            SlateEditor.withoutNormalizing(editor, () => {
                                Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: expectedLength }, focus: { path: path.concat([0]), offset: text.length } } })
                                Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                                Transforms.move(editor, { distance: textAfter.length } );
                            });
                            return;
                        }
                    } else if (d.children.length >= 3) {
                        // chars behind last JsonSyntax }?
                        const cl = d.children[d.children.length - 1];
                        if ('type' in cl && cl.type === 'JsonSyntax') {
                            const match = (/^\s*\]\s*([{},"[\]:]+)$/g).exec(cl.text);//const match = (/^\s*\]\s*([{},"\[\]:]+)$/g).exec(cl.text);
                            if (match && match.length > 0) {
                                const textAfter = match[1];
                                console.log(`withJsonElements.normalizeNode: rule #12.1: text='${cl.text}' textAfter='${textAfter}'`);
                                // split the rest away
                                const expectedLength = cl.text.length - textAfter.length;
                                SlateEditor.withoutNormalizing(editor, () => {
                                    Transforms.delete(editor, { at: { anchor: { path: path.concat([d.children.length - 1]), offset: expectedLength }, focus: { path: path.concat([d.children.length - 1]), offset: cl.text.length } } })
                                    Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: cl.text.slice(expectedLength) }], { at: Path.next(path) });
                                    Transforms.move(editor, { distance: textAfter.length } );
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }

        if (type === 'JsonObject') {
            const d = node as Descendant;
            if (!isValidJson(d)) {
                if ('children' in d) {
                    if (d.children.length === 1) { // special case for empty obj
                        const text = Node.string(node);
                        if (text.trim().length===0){ // remove empty
                            console.log(`withJsonElements.normalizeNode: rule #10.3: text='${text}'`);
                            Transforms.removeNodes(editor, {at: path});
                            return;
                        }
                        // any chars behind?
                        const match = (/^\s*{\s*}([{},"[\]:]+)$/g).exec(text); // const match = (/^\s*{\s*}([{},"\[\]:]+)$/g).exec(text);
                        if (match && match.length > 0) {
                            const textAfter = match[1];
                            console.log(`withJsonElements.normalizeNode: rule #10: text='${text}' textAfter='${textAfter}'`);
                            // split the rest away
                            const expectedLength = text.length - textAfter.length;
                            SlateEditor.withoutNormalizing(editor, () => {
                                Transforms.delete(editor, { at: { anchor: { path: path.concat([0]), offset: expectedLength }, focus: { path: path.concat([0]), offset: text.length } } })
                                Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: text.slice(expectedLength) }], { at: Path.next(path) });
                                Transforms.move(editor, {distance: textAfter.length});
                            });
                            return;
                        }
                    } else if (d.children.length >= 3) {
                        // chars behind last JsonSyntax }?
                        const cl = d.children[d.children.length - 1];
                        if ('type' in cl && cl.type === 'JsonSyntax') {
                            const match = (/^\s*}\s*([{},"[\]:]+)$/g).exec(cl.text); // const match = (/^\s*}\s*([{},"\[\]:]+)$/g).exec(cl.text);
                            if (match && match.length > 0) {
                                const textAfter = match[1];
                                console.log(`withJsonElements.normalizeNode: rule #10.2: text='${cl.text}' textAfter='${textAfter}'`);
                                // split the rest away
                                const expectedLength = cl.text.length - textAfter.length;
                                SlateEditor.withoutNormalizing(editor, () => {
                                    Transforms.delete(editor, { at: { anchor: { path: path.concat([d.children.length - 1]), offset: expectedLength }, focus: { path: path.concat([d.children.length - 1]), offset: cl.text.length } } })
                                    Transforms.insertNodes(editor, [{ type: 'JsonSyntax', text: cl.text.slice(expectedLength) }], { at: Path.next(path) });
                                    Transforms.move(editor, {distance: textAfter.length});
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }

        if (type === 'JsonMember') {
            const d = node as JsonMember;
            if (!isValidMember(d)) {
                const text = Node.string(node);
                if (text.trim().length===0){ // remove empty
                    console.log(`withJsonElements.normalizeNode: rule #8.2: text='${text}'`);
                    Transforms.removeNodes(editor, {at: path});
                    return;
                }
                // more than 5 member?
                if (d.children.length > 5) {
                    console.log(`withJsonElements.normalizeNode:${path} rule #8:`);
                    Transforms.moveNodes(editor, { at: path.concat([5]), to: Path.next(path) });
                    return;
                } else if (d.children.length === 5) {
                    // last child should be empty...
                    //if ()
                }
            }
        }

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
            if (value.length === 0) return { type: 'JsonString', children: [{ type: 'JsonSyntax', text: '""' }] };
            return { type: 'JsonString', children: [{ type: 'JsonSyntax', text: '"' }, { text: value }, { type: 'JsonSyntax', text: '"' }] }
        case 'boolean':
            return { type: 'JsonBool', children: [{ text: JSON.stringify(value) }] }
        case 'bigint':
        case 'number':
            return { type: 'JsonNumber', children: [{ text: JSON.stringify(value) }] }
        case 'object':
            if (!Array.isArray(value)) {
                const newE: JsonObject = { 'type': 'JsonObject', children: [{ type: 'JsonSyntax', text: '{' }] };
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
            } else { // Array
                const arrLen = value.length;
                const newE: JsonArray = arrLen > 0 ? { 'type': 'JsonArray', children: [{ type: 'JsonSyntax', text: '[' }] } : { 'type': 'JsonArray', children: [{ type: 'JsonSyntax', text: '[]' }] };
                value.forEach((c, index) => {
                    if (index > 0) { newE.children.push({ type: 'JsonSyntax', text: ',' }); }
                    const newC = desValue(c);
                    if (newC !== undefined) newE.children.push(newC);
                });
                if (arrLen > 0) {
                    newE.children.push({ type: 'JsonSyntax', text: ']' });
                }
                return newE;
            }
        default:
            return { type: 'JsonBool', children: [{ text: 'null' }] }
    }
}

const deserialize = (obj: any): (Descendant)[] => {
    // console.log(`deserialize(${JSON.stringify(obj)})...`);
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
            if ('children' in d) {
                if (d.children.length === 3) {
                    const c1 = d.children[0];
                    const c2 = d.children[1];
                    const c3 = d.children[2];
                    const c1Valid = 'type' in c1 && c1.type === 'JsonSyntax' && c1.text === '"';
                    const c3Valid = 'type' in c3 && c3.type === 'JsonSyntax' && c3.text === '"';
                    const c2Valid = !('type' in c2);
                    if (!c1Valid && c2Valid && c3Valid) return undefined;
                    return d.isJsonUnescaped ? c2.text : JSON.parse(c1.text + c2.text + c3.text);
                } else if (d.children.length === 1) {
                    return ""; // only empty JsonSyntax ""
                }
            }
            return undefined;
        }
        case 'JsonNumber': {
            if ('children' in d && d.children.length === 1) {
                return Number(d.children[0].text);
            }
            return undefined
        }
        case 'JsonObject': {
            if ('children' in d) {
                if (d.children.length === 1) {
                    return {};
                } else {
                    // todo serialize member
                    const obj: any = {};
                    for (let i = 1; i < d.children.length; ++i) { // we skip the first ...
                        const c = d.children[i];
                        if (c.type === 'JsonSyntax') continue;
                        if (c.type === 'JsonMember') {
                            obj[(c.children[1] as JsonKey).text] = serValue(c.children[3]);
                        }
                    }
                    return obj;
                }
            }
            return undefined
        }
        case 'JsonArray': {
            if ('children' in d) {
                if (d.children.length === 1) {
                    return [];
                } else {
                    const arr: any[] = [];
                    for (let i = 1; i < d.children.length; ++i) { // we skip the first ...
                        const c = d.children[i];
                        if (c.type === 'JsonSyntax') continue;
                        arr.push(serValue(c));
                    }
                    return arr;
                }
            }
            return undefined
        }
    }
}

/**
 * serialize the editor structure back into a valid (json) object
 * @param value 
 * @returns a valid (json) object,array,string, number, boolean, null or undefined
 */
export const serialize = (value: Descendant[]): any => {
    // console.log(`serialize(value=${JSON.stringify(value)})...`);
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

const debugObj = (v: any, indent: number): string => {
    const indentOffset = (' '.repeat(indent));
    if (Array.isArray(v)) {
        return indentOffset + v.map(e => debugObj(e, indent)).join('\n' + indentOffset);
    }
    if (typeof (v) === 'object' && 'children' in v) {
        const isValid = v.type === 'JsonMember'? isValidMember(v) : isValidJson(v);
        const type = v.type === 'JsonString' ? `JsonString(unescaped=${v.isJsonUnescaped})` : v.type;
        return (isValid ? '+' : '-') + indentOffset + `${type}:[(#children=${v.children.length})\n` + debugObj(v.children, indent + 1);
    }
    if (typeof (v) === 'object' && 'type' in v) {
        const isValid = isValidJson(v);
        const type = v.type === 'JsonString' ? `JsonString(unescaped=${v.isJsonUnescaped})` : v.type;
        return (isValid ? '+' : '-') + indentOffset + `${type}: '${v.text}'`;
    }
    if (typeof (v) === 'object' && 'text' in v) {
        return indentOffset + `text: '${v.text}'`;
    }
    return indentOffset + JSON.stringify(v, undefined)
}

const debugHtml = (value: Descendant[]) => {
    return debugObj((value[0] as any).children, 0);
}

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
                Transforms.move(editor, { unit: 'character', reverse: true })
                return
            }
            if (isKeyHotkey('right', nativeEvent)) {
                //console.log(`onKeyDown(right)...path=${selection.anchor.path.join('/')}:${selection.anchor.offset}`);
                event.preventDefault()
                Transforms.move(editor, { unit: 'character' })
                return
            }
        }
    }

    return (
        <React.Fragment>
            <Slate editor={editor} value={document} onChange={value => { /*console.log('onChange...'); */setDocument(value); }} /*const serialized = serialize(value); if (serialized !== undefined) { onChange(serialized); } }}*/>
            <Editable
                renderElement={renderElement}
                renderLeaf={renderLeaf}
                onKeyDown={onKeyDown}
            />
        </Slate>
            <pre style={{ whiteSpace: 'pre', textAlign: 'left' }}>
                <code>
                    {debugHtml(document)}
                </code>
            </pre>
            As JSON:
            <pre style={{ whiteSpace: 'pre', textAlign: 'left' }}>
                <code>
                    {JSON.stringify(serialize(document), null, 2)}
                </code>
            </pre>
        </React.Fragment>
    );
}
