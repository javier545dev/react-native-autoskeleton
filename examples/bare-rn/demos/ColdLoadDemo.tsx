/**
 * DEMO — Cold load.
 *
 * The whole library in six lines: wrap real UI in `<AutoSkeleton isLoading>`.
 * No skeleton layout is authored anywhere. The shapes you see are the frames
 * the native sensor measured from the very content underneath.
 *
 * "Load again (cold)" bumps a React `key` so the instance genuinely remounts.
 * That is not a workaround: `isLoading` going true on a LIVE instance that
 * has already shown content is the pull-to-refresh case, which REQ-PTR-1
 * deliberately keeps showing the stale content instead. The Refresh demo is
 * about exactly that; this one is about the cold path.
 */

import { AutoSkeleton } from 'autoskeleton';
import { Button, useFakeLoad } from './controls';
import { SampleCard } from './SampleCard';
import { DemoPage, Panel, Row } from './ui';

export function ColdLoadDemo(): React.JSX.Element {
  const load = useFakeLoad(1600);

  return (
    <DemoPage
      title="Cold load"
      claim="Wrap existing UI. The skeleton is derived from the real measured layout — you never author one."
    >
      <Panel
        label="<AutoSkeleton isLoading skeletonKey='demo-cold'>"
        note="First run traverses the native view tree. Every later run of the same key draws from the snapshot cache on the first frame."
      >
        <AutoSkeleton key={load.coldKey} isLoading={load.isLoading} skeletonKey="demo-cold">
          <SampleCard />
        </AutoSkeleton>
      </Panel>
      <Row>
        <Button label="Load again (cold)" testID="demo-cold-reload" onPress={load.reloadCold} />
      </Row>
    </DemoPage>
  );
}
