import React, { useMemo, useState, useCallback } from 'react'
import { createEditor, Descendant, Range, Transforms } from 'slate'
import { Slate, Editable, withReact, RenderLeafProps } from 'slate-react'
import { withHistory } from 'slate-history'
import { isKeyHotkey } from 'is-hotkey'



const PlainTextExample = () => {
    const editor = useMemo(() => withHistory(withReact(createEditor())), [])
    const [document, setDocument] = useState(initialValue);

    const renderLeaf = useCallback(({ attributes, children, leaf }: RenderLeafProps) => {
        // works: return <span {...attributes} title={'' + leaf.type}>{children}</span>;
        let el = <>{children}</>;
        //return <span {...attributes} title={'' + leaf.type}>{el}</span>;
        if ('type' in leaf) {
            switch (leaf.type) {
                case 'JsonKey': el = <strong>{el}</strong>; break;
                case 'JsonValue': el = <em>{el}</em>; break;
                case 'JsonString': break;
                default:
                    console.log('unknown leaf.type', leaf.type);
                    el = <u>{el}</u>; break;
            }
        }
        return <span {...attributes} title={'' + leaf.type}>{el}</span>;
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
                console.log(`onKeyDown(left)...`, selection);
                event.preventDefault()
                Transforms.move(editor, { unit: 'offset', reverse: true })
                return
            }
            if (isKeyHotkey('right', nativeEvent)) {
                console.log(`onKeyDown(right)...path=${selection.anchor.path.join('/')}:${selection.anchor.offset}`);
                event.preventDefault()
                Transforms.move(editor, { unit: 'offset' })
                return
            }
        }
    }

    return (
        <Slate editor={editor} value={document}>
            <Editable placeholder="Enter some plain text..."
                renderLeaf={renderLeaf}
                onKeyDown={onKeyDown} />
        </Slate>
    )
}

const initialValue: Descendant[] = [
    {
        type: 'JsonDoc',
        children: [
            { children: [{ text: 'This is editable plain text, just like a <textarea>!' }], type: "JsonString" },
        ],
    },
]

export default PlainTextExample