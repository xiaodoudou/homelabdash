import { h } from 'vue'
import { valueParts } from '../../views.js'

/**
 * A formatted value with its unit in smaller, quieter type. A render function, because a template would put
 * whitespace between the number and its unit.
 * @param {{ text: string, format?: string, unit?: string }} props
 */
export default function ValueText (props) {
  return valueParts(props.text, props.format, props.unit).map(p => p.unit ? h('span', { class: 'u' }, p.text) : p.text)
}
ValueText.props = ['text', 'format', 'unit']
