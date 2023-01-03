/* eslint-disable testing-library/no-node-access */
import Editor from './Editor';
import { isValidJson, serialize } from './Editor';
import { create, act /*, ReactTestRenderer*/ } from 'react-test-renderer';
import { withReact, ReactEditor } from 'slate-react';
import { BaseEditor, createEditor, Transforms, Node, Editor as SlateEditor } from 'slate';

const createNodeMock = () => ({
    ownerDocument: global.document,
    getRootNode: () => global.document,
})

test('editor enter valid jsons', async () => {
    let editor: (BaseEditor & ReactEditor) = withReact(createEditor());// only to avoid undefined issues...

    const testInput = async (obj: any, expectedText?: string) => {
        const inputChars = JSON.stringify(obj);
        return testInputText(inputChars, obj, expectedText ? expectedText : inputChars);
    }

    const testInputText = async (inputChars: string, expectedObj: any, expectedText: string) => {
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
            Transforms.insertText(editor!, inputChars.slice(0, 1)); // , { at: firstPath });
            for (let i = 1; i < inputChars.length; ++i) {
                console.log(`sending: '${inputChars.slice(i, i + 1)}'`);
                Transforms.insertText(editor!, inputChars.slice(i, i + 1));
            }
        })
        console.log(`editor.children=${JSON.stringify(editor.children)}`);
        //console.log(`editor=`, editor);
        expect(editor.children.length).toBe(1);
        expect(isValidJson(editor.children[0])).toBeTruthy();
        expect(Node.string(editor)).toBe(expectedText);
        const convObj = serialize(editor.children);
        expect(convObj).toEqual(expectedObj);
    }

    await testInput(true)
    await testInput(false)
    await testInput(null)
    await testInput('foo')
    await testInput('fo"o', '"fo"o"') // todo we dont want the editor to show the escaped \" but only the "
    await testInput(42)
    await testInput(-42.5)
    await testInput(-42.5e-2)
    await testInputText('-42.5e-2', -42.5e-2, '-42.5e-2');

    console.log(`editor=${JSON.stringify(editor.children)}`, editor);

    //console.log(`el=`, el.toTree());
});
