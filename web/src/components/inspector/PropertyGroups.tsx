import { Fragment } from 'react';

import type { SelectedDetailsPropertyGroup } from '../../types/workbench';

type PropertyGroupsProps = {
  groups: SelectedDetailsPropertyGroup[];
};

export function PropertyGroups({ groups }: PropertyGroupsProps) {
  return (
    <div className="selection-property-groups">
      {groups.map((group) => (
        <section key={group.title} className="node-settings-card">
          <div className="node-settings-section-header">
            <div>
              <span className="panel-kicker">属性</span>
              <h4>{group.title}</h4>
            </div>
          </div>
          <dl className="node-settings-facts">
            {group.rows.map((row) => (
              <Fragment key={`${group.title}-${row.label}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
