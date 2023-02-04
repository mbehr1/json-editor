import React from 'react'
import './App.css'

import Editor, { TSJSONValue } from './components/Editor'
import PlainTextExample from './components/plaintext'

const ExampleObj: TSJSONValue | undefined = undefined // { 'foo': true, 'bar': 'barValue', 'obj': { 'bool': false, 'conversionFunction': "return '';" } };

function App(): JSX.Element {
  const [obj, updateObj] = React.useState(ExampleObj)
  return (
    <div className="App">
      {false && <PlainTextExample />}
      {<Editor key='#1' object={obj} onChange={updateObj} />}
    </div>
  )
}

export default App
