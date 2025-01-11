import {
    LitElement,
    html,
    css,
  } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
  

class AccessControlManager extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
            narrow: { type: Boolean },
            route: { type: Object },
            panel: { type: Object },
        };
    }

    constructor() {
        super();
    }

    render() {
        return html`
        <div>
          <header class="mdc-top-app-bar mdc-top-app-bar--fixed">
            <div class="mdc-top-app-bar__row">
              <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-start" id="navigation">
                <span class="mdc-top-app-bar__title">
                  ${this.panel.title}
                </span>
              </section>
              <section class="mdc-top-app-bar__section mdc-top-app-bar__section--align-end" id="actions" role="toolbar">
                <slot name="actionItems"></slot>
              </section>
            </div>
          </header>
        `
    }
}

customElements.define('access-control-manager', AccessControlManager);