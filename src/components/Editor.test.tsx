import Editor from './Editor';
import { isValidJson, serialize, TSJSONValue } from './Editor';
import { create, act /*, ReactTestRenderer*/ } from 'react-test-renderer';
import { withReact, ReactEditor } from 'slate-react';
import { BaseEditor, createEditor, Transforms, Node, Editor as SlateEditor } from 'slate';

/* bugs:
 [ ] enter to use line breaks doesn't work
 [ ] editing arrays (partly works. change of type does not. e.g. [1,2]-> [1,false,2])
 [ ] deleting an array member leads to normalization loop
 [ ] enter while typing a string (so at the end of the string)
*/


const createNodeMock = () => ({
    ownerDocument: global.document,
    getRootNode: () => global.document,
})

const testInputText = async (editor: BaseEditor & ReactEditor, inputChars: string, expectedObj: TSJSONValue | undefined, expectedText: string) => {
    console.warn(`testInputText :'${inputChars}'`, expectedObj);
    // first: input char by char

    // slate updates at next tick, so we need this to be async
    await act(async () => {
        //Transforms.splitNodes(editor, { at: { path: [0, 0], offset: 2 } })
        Transforms.select(editor, { anchor: SlateEditor.start(editor, []), focus: SlateEditor.start(editor, []) });
        console.log(`sending: '${inputChars.slice(0, 1)}'`);
        Transforms.insertText(editor, inputChars.slice(0, 1)); // , { at: firstPath });
        for (let i = 1; i < inputChars.length; ++i) {
            console.log(`sending: '${inputChars.slice(i, i + 1)}'`);
            Transforms.insertText(editor, inputChars.slice(i, i + 1));
        }
    })
    console.log(`editor.children=${JSON.stringify(editor.children)}`);
    //console.log(`expectedText='${expectedText}'`);
    expect(editor.children.length).toBe(1);
    expect(Node.string(editor)).toBe(expectedText);
    if (expectedObj !== undefined) {
        expect(isValidJson(editor.children[0])).toBeTruthy();
        const convObj = serialize(editor.children);
        expect(convObj).toEqual(expectedObj);
    }
}

type Op = {
    op: string, // left/right or insert
    times?: number,
    data?: string, // for insert
}

type Ops = Op[];

const testEdit = async (editor: BaseEditor & ReactEditor, ops: Ops, expectedObj: TSJSONValue, expectedText: string) => {
    await act(async () => {
        for (const op of ops){
            switch (op.op){
                case 'left': // todo handle selection properly!
                    Transforms.move(editor, {distance: op.times ? op.times : 1, unit:'character', reverse:true});
                    break;
                case 'right': // todo handle selection properly!
                    Transforms.move(editor, {distance: op.times ? op.times : 1, unit:'character'});
                    break;
                case 'insert':
                    expect(op.data).toBeTruthy();
                    if (op.data !== undefined) {
                        for (let i = 0; i < (op.times ? op.times : 1); i++) {
                            console.log(`sending: '${op.data}'`);
                            Transforms.insertText(editor, op.data);
                        }
                    }
                    break;
                default:
                    expect(false).toBeTruthy();
            }
        }
    })
    console.log(`editor.children=${JSON.stringify(editor.children)}`);
    expect(editor.children.length).toBe(1);
    expect(Node.string(editor)).toBe(expectedText);
    expect(isValidJson(editor.children[0])).toBeTruthy();
    const convObj = serialize(editor.children);
    expect(convObj).toEqual(expectedObj);

}

test('editor edit existing', async ()=>{
    let editor: (BaseEditor & ReactEditor) = withReact(createEditor());// only to avoid undefined issues...
    await act(() => {
        /*el =*/ create(
        <Editor key='#2' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }
    )
    })
    expect(editor).toBeDefined()

    // edit an array of bools at the end
    await testInputText(editor, '[true]', [true], '[true]')
    await testEdit(editor, [{op:'left',times: 1}, {op:'insert', data: ',false'}], [true, false], '[true,false]');

    // edit an array of numbers at the end
    await act(() => { create(<Editor key='#2' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }) })
    await testInputText(editor, '[1]', [1], '[1]')
    await testEdit(editor, [{ op: 'left', times: 1 }, { op: 'insert', data: ',2,3' }], [1, 2, 3], '[1,2,3]');


    // insert a json to be escaped char into the prefilled string:
    await act(() => { create(<Editor key='#3' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }) })
    await testInputText(editor, '{"a":"', undefined, '{"a":"string"')
    await testEdit(editor, [{ op: 'right', times: 7 }, { op: 'insert', data: '}' }], { a: 'string' }, '{"a":"string"}')
    await testEdit(editor, [{ op: 'left', times: 5 }, { op: 'insert', data: '"' }], { a: 'str"ing' }, '{"a":"str"ing"}')


    // edit an array of numbers in the middle
    await act(() => { create(<Editor key='#2' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }) })
    await testInputText(editor, '[1,3]', [1, 3], '[1,3]')
    await testEdit(editor, [{ op: 'left', times: 2 }, { op: 'insert', data: '2,' }], [1, 2, 3], '[1,2,3]');

    await act(() => { create(<Editor key='#2' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }) })
    await testInputText(editor, '[1,3]', [1, 3], '[1,3]')
    await testEdit(editor, [{ op: 'left', times: 2 }, { op: 'insert', data: '2' }, { op: 'insert', data: ',' }], [1, 2, 3], '[1,2,3]');


})

test('editor enter valid jsons', async () => {
    let editor: (BaseEditor & ReactEditor) = withReact(createEditor());// only to avoid undefined issues...

    const testInput = async (obj: TSJSONValue, expectedText?: string) => {
        const inputChars = JSON.stringify(obj);
        return testInputText(inputChars, obj, expectedText ? expectedText : inputChars);
    }

    const testInputText = async (inputChars: string, expectedObj: TSJSONValue, expectedText: string) => {
        console.warn(`testInputText :'${inputChars}'`, expectedObj);
        //let el: ReactTestRenderer
        act(() => {
            /*el =*/ create(
            <Editor key='#1' object={undefined} getEditor={(ed) => editor = ed} />, { createNodeMock }
        )
        })
        expect(editor).toBeDefined()

        // first: input char by char

        // slate updates at next tick, so we need this to be async
        await act(async () => {
            //Transforms.splitNodes(editor, { at: { path: [0, 0], offset: 2 } })
            Transforms.select(editor, { anchor: SlateEditor.start(editor, []), focus: SlateEditor.start(editor, []) });
            console.log(`sending: '${inputChars.slice(0, 1)}'`);
            Transforms.insertText(editor, inputChars.slice(0, 1)); // , { at: firstPath });
            for (let i = 1; i < inputChars.length; ++i) {
                console.log(`sending: '${inputChars.slice(i, i + 1)}'`);
                Transforms.insertText(editor, inputChars.slice(i, i + 1));
            }
        })
        console.log(`editor.children=${JSON.stringify(editor.children)}`);
        //console.log(`expectedText='${expectedText}'`);
        expect(editor.children.length).toBe(1);
        expect(Node.string(editor)).toBe(expectedText);
        expect(isValidJson(editor.children[0])).toBeTruthy();
        const convObj = serialize(editor.children);
        expect(convObj).toEqual(expectedObj);
    }

    await testInput(true)
    await testInput(false)
    await testInput(null)
    await testInput('')
    await testInput('foo')
    await testInput('fo"o', '"fo"o"') // we dont want the editor to show the escaped \" but only the "
    await testInput('fo"\no', '"fo"\no"')
    await testInput(42)
    await testInput(-42.5)
    await testInput(-42.5e-2)
    await testInputText('-42.5e-2', -42.5e-2, '-42.5e-2');

    await testInput([])
    await testInput([true])
    await testInput([true, false, null])
    await testInput([""])
    await testInput(["", true])
    await testInput(['', 'foo'])
    await testInput([{}])
    await testInput([[]])
    await testInput([[[],{}]])
    await testInput([[{},[]]])
    await testInput([1,2])
    await testInput(["foo", false, null, [true, false]])

    await testInput({})
    await testInput({ foo: true }) // single member, bool
    await testInput({ foo: false })
    await testInput({ foo: null })
    await testInput({ a: "" })
    await testInput({ a: "b" })
    await testInput({ a: 'fo"o' }, '{"a":"fo"o"}') // see above, no escaped chars shown in the editor
    await testInput({ a: 42 })
    await testInput({ a: -42.5 })
    await testInput({a:[]});
    await testInput({ foo: null, bla: true }) // two member, bool at start and end
    await testInput({ a: false, b: -42.5 }) // two member, bool and number
    await testInput({ a: -42.5, b: null }) // two member, bool and number
    await testInput({ a: false, b: "-42.5" }) // two member, bool and string
    await testInput({ a: false, b: "" }) // two member, bool and string
    await testInput({ a: "", b: -42.5 }) // two member, string and number
    await testInput({ a: -42.5, b: "" }) // two member, string and number
    await testInput({ a: -42.5, b: "", c: false }) // three member, number, string and bool
    await testInput({ b: "", c: false, a: -42.5 }) // three member, number, string and bool
    await testInput({ c: false, a: -42.5, b: "" }) // three member, number, string and bool

    await testInput({ a: {} }) // one member: empty object
    await testInput({ a: { b: true } }) // one member: object with single entry
    await testInput({ a: { b: "", c: 42.5 }, d: false }) // two member: object with two entries
    await testInput({ a: { b: [1,2], c: [null,"]"] }, d: false }) // two member: object with two entries

    console.log(`editor=${JSON.stringify(editor.children)}`, editor);

    // todo add test for rule #6.2

    //console.log(`el=`, el.toTree());
});
