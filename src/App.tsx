import {
  Alert,
  AppShell,
  Badge,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconBluetooth, IconChartDots } from '@tabler/icons-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrandMark } from './components/BrandMark';
import { LiveInputs } from './components/LiveInputs';
import { DEFAULT_BUILDER_STATE, selectedChannels, type BuilderState } from './domain/builder';
import { inputBus, type ConnectionStatus } from './domain/bus';
import { SignalStore } from './domain/signalStore';
import {
  connectBluetooth,
  disconnectBluetooth,
  isBluetoothSupported,
} from './services/bluetooth';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const SetupPage = lazy(() => import('./pages/SetupPage').then((module) => ({ default: module.SetupPage })));
const ControllerPage = lazy(() => import('./pages/ControllerPage').then((module) => ({ default: module.ControllerPage })));
const GamePage = lazy(() => import('./pages/GamePage').then((module) => ({ default: module.GamePage })));

export type PageId = 'home' | 'setup' | 'controller' | 'game';

const pages: Array<{ id: PageId; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'setup', label: 'Setup' },
  { id: 'controller', label: 'Controller' },
  { id: 'game', label: 'Game' },
];

function pageFromHash(): PageId {
  const hash = window.location.hash.slice(1);
  return pages.some((page) => page.id === hash) ? hash as PageId : 'home';
}

export function App() {
  const [signalStore] = useState(() => new SignalStore(inputBus));
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [builder, setBuilder] = useState<BuilderState>(() => ({
    selected: new Set(DEFAULT_BUILDER_STATE.selected),
    pinModes: { ...DEFAULT_BUILDER_STATE.pinModes },
  }));
  const [liveOpened, setLiveOpened] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'disconnected' });

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => signalStore.setPlannedChannels(selectedChannels(builder)), [builder, signalStore]);

  useEffect(() => inputBus.onStatus(setStatus), []);

  useEffect(() => {
    let timer = 0;
    const unsubscribe = inputBus.onInput(() => {
      setActive(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(false), 400);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => () => signalStore.destroy(), [signalStore]);

  const navigate = (next: PageId) => {
    window.location.hash = next;
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const connecting = status.state === 'connecting';
  const connected = status.state === 'connected';

  return (
    <AppShell header={{ height: { base: 112, sm: 68 } }} padding={0}>
      <AppShell.Header className="app-header">
        <Container size="xl" h="100%" className="header-inner">
          <Group className="header-top" justify="space-between" wrap="nowrap">
            <UnstyledButton className="brand" onClick={() => navigate('home')} aria-label="Experimental Game Controllers home">
              <BrandMark />
              <Text fw={750} visibleFrom="xs">Experimental Game Controllers</Text>
              <Text fw={750} hiddenFrom="xs">Controllers</Text>
            </UnstyledButton>

            <Group gap="xs" wrap="nowrap">
              <Button
                className={active ? 'live-button live-button--active' : 'live-button'}
                variant="subtle"
                color="gray"
                size="sm"
                leftSection={<IconChartDots size={17} />}
                onClick={() => setLiveOpened(true)}
              >
                Live
              </Button>
              <Button
                size="sm"
                variant={connected ? 'light' : 'filled'}
                color={connected ? 'teal' : 'blue'}
                loading={connecting}
                leftSection={<IconBluetooth size={17} />}
                onClick={async () => {
                  if (connected) return disconnectBluetooth();
                  try {
                    await connectBluetooth();
                  } catch {
                    // Cancellation and browser errors are reflected by connection status.
                  }
                }}
              >
                {connected ? status.message ?? 'Connected' : 'Connect'}
              </Button>
            </Group>
          </Group>

          <nav className="page-nav" aria-label="Main sections">
            {pages.map((item) => (
              <Button
                key={item.id}
                size="compact-sm"
                variant={page === item.id ? 'light' : 'subtle'}
                color={page === item.id ? 'blue' : 'gray'}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </nav>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        {!isBluetoothSupported() && (
          <Container size="xl" pt="md">
            <Alert color="yellow" title="Bluetooth unavailable">
              Use desktop or Android Chrome/Edge to connect hardware. The test inputs and game still work here.
            </Alert>
          </Container>
        )}
        <Suspense fallback={<Center mih="60vh"><Loader /></Center>}>
          {page === 'home' && <HomePage onNavigate={navigate} />}
          {page === 'setup' && <SetupPage onNavigate={navigate} />}
          {page === 'controller' && (
            <ControllerPage state={builder} onChange={setBuilder} onNavigate={navigate} />
          )}
          {page === 'game' && <GamePage signalStore={signalStore} inputBus={inputBus} />}
        </Suspense>
      </AppShell.Main>

      <Box component="footer" className="app-footer">
        <Container size="xl">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Fidget Camp 2026 · Experimental Game Controllers</Text>
            <Badge
              component="a"
              href="https://github.com/hankfoot/experimental-game-controllers"
              target="_blank"
              variant="light"
              color="gray"
            >
              GitHub
            </Badge>
          </Group>
        </Container>
      </Box>

      <LiveInputs
        opened={liveOpened}
        onClose={() => setLiveOpened(false)}
        signalStore={signalStore}
        inputBus={inputBus}
      />
    </AppShell>
  );
}
