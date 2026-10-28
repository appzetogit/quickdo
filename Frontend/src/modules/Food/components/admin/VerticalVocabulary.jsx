import { useEffect, useRef } from "react"
import { translate, isDataNode, VERTICAL } from "@food/utils/verticalVocabulary"

/**
 * Transitional shim: rewrites food vocabulary into quick-commerce vocabulary for the
 * copy still hardcoded inside the shared admin screens.
 *
 * The QC panel deliberately reuses the food admin screens (see AdminRouter), so their
 * copy -- card titles, buttons, empty states -- says "Food" and "Restaurant" in a
 * vertical that sells groceries through sellers. Editing every string is a 165-file
 * change and every new food screen would reintroduce the words, so the swap happens
 * here for now.
 *
 * It is a shim, not the design. The real fix is `translate()` called by the component
 * that owns the string: explicit, testable, and incapable of touching data. The
 * sidebar already works that way -- it relabels the menu tree in React using
 * rulesFor(). Move screens onto that as they are edited, and delete this file once
 * nothing food-worded is left.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This used to rewrite EVERY text node under the subtree, which meant it rewrote data
 * as readily as labels: a seller genuinely named "Restaurant Paradise" rendered as
 * "Seller Paradise", and a customer note mentioning food became one mentioning
 * product. The shim was corrupting the records it was supposed to be labelling, and
 * the original comment shrugged that off as acceptable. It is not -- a support agent
 * reading a mangled seller name back to a customer has no way to know the screen
 * lied to them.
 *
 * isDataNode() now excludes the containers that hold values (table cells, inputs,
 * options, code) while leaving chrome translated. `th` stays translated because a
 * column heading is a label. Anything else that must be left alone opts out with
 * `data-no-vocab`.
 */

const rewriteTextNodes = (root, vertical) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            // Walk the whole ancestor chain, not just the immediate parent: a seller
            // name is usually wrapped in a span inside the cell, so checking one
            // level up would still rewrite it.
            for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
                if (isDataNode(el)) return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
        },
    })

    let node
    while ((node = walker.nextNode())) {
        const next = translate(node.nodeValue, vertical)
        if (next !== node.nodeValue) node.nodeValue = next
    }
}

export default function VerticalVocabulary({ children, vertical = VERTICAL.QUICK_COMMERCE }) {
    const ref = useRef(null)

    useEffect(() => {
        const root = ref.current
        if (!root) return undefined

        let observer
        // The observer is disconnected while it edits so its own mutations never
        // re-trigger it.
        const apply = () => {
            observer.disconnect()
            rewriteTextNodes(root, vertical)
            observer.observe(root, { childList: true, characterData: true, subtree: true })
        }
        observer = new MutationObserver(apply)
        observer.observe(root, { childList: true, characterData: true, subtree: true })
        rewriteTextNodes(root, vertical)

        return () => observer.disconnect()
    }, [vertical])

    // display:contents keeps this wrapper out of the layout entirely.
    return (
        <div ref={ref} style={{ display: "contents" }}>
            {children}
        </div>
    )
}
