import { Alert, Anchor, Button, Container, Group, Image, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconArrowRight, IconBluetooth, IconExternalLink } from '@tabler/icons-react';
import setupChooserImage from '../../assets/setup-chooser.png';
import setupMicrobitImage from '../../assets/setup-microbit.png';
import setupNameVideo from '../../assets/setup-name.mp4';
import setupPairImage from '../../assets/setup-pair.png';
import setupProjectImage from '../../assets/setup-project.png';
import { CopyCode } from '../components/CopyCode';
import type { PageId } from '../App';

const starterCode = `bluetooth.startUartService()
let connected = false
bluetooth.onBluetoothConnected(function () {
    connected = true
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
})
basic.forever(function () {
    if (connected) {
        basic.showIcon(IconNames.Yes)
    } else {
        basic.showString(control.deviceName())
    }
})`;

interface SetupPageProps {
  onNavigate(page: PageId): void;
}

interface SetupStepProps {
  number: number;
  title: string;
  children: React.ReactNode;
}

function SetupStep({ number, title, children }: SetupStepProps) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="lg">
      <ThemeIcon size={42} radius="xl" variant="filled" color="blue" className="step-number">
        {number}
      </ThemeIcon>
      <Stack gap="sm" style={{ minWidth: 0, flex: 1 }}>
        <Title order={3}>{title}</Title>
        {children}
      </Stack>
    </Group>
  );
}

export function SetupPage({ onNavigate }: SetupPageProps) {
  return (
    <Container size="md" py="xl">
      <Stack gap="xs" mb="xl">
        <Title order={1}>Set up your micro:bit</Title>
        <Text c="dimmed" size="lg">A one-time setup. It usually takes a couple of minutes.</Text>
      </Stack>
      <Paper radius="lg" withBorder p={{ base: 'md', sm: 'xl' }}>
        <Stack gap={44}>
          <SetupStep number={1} title="Grab a micro:bit v2">
            <Text>You’ll need a micro:bit v2 and USB cable. A battery pack is useful once you unplug.</Text>
            <Image src={setupMicrobitImage} alt="A micro:bit v2 board" radius="md" maw={500} />
          </SetupStep>
          <SetupStep number={2} title="Open the ready-made MakeCode project">
            <Text>
              Open the{' '}
              <Anchor href="https://makecode.microbit.org/_JguX2x325Wva" target="_blank">
                starter project <IconExternalLink size={14} />
              </Anchor>
              , choose <strong>Edit Code</strong>, then switch to the JavaScript tab.
            </Text>
            <Image src={setupProjectImage} alt="MakeCode starter project" radius="md" />
          </SetupStep>
          <SetupStep number={3} title="Paste the starter code">
            <Text>Replace the editor contents with this code. The Controller page will generate the full version later.</Text>
            <CopyCode code={starterCode} />
          </SetupStep>
          <SetupStep number={4} title="Flash it over USB">
            <Text>Click <strong>Download</strong> in MakeCode and follow the pairing prompt the first time.</Text>
            <Image src={setupPairImage} alt="Browser pairing prompt for a micro:bit" radius="md" />
          </SetupStep>
          <SetupStep number={5} title="Find your board’s name">
            <Text>
              The LEDs scroll a unique five-letter name. Remember it so you can find the matching
              <code> BBC micro:bit [·····]</code> in a room full of boards.
            </Text>
            <video className="setup-video" src={setupNameVideo} autoPlay loop muted playsInline />
          </SetupStep>
          <SetupStep number={6} title="Connect from this site">
            <Text>
              Click <strong>Connect</strong> in the header and choose the device with your five letters.
              You’ll need to reconnect after refreshing the page.
            </Text>
            <Image src={setupChooserImage} alt="Bluetooth chooser listing micro:bits" radius="md" />
          </SetupStep>
        </Stack>
      </Paper>
      <Alert mt="lg" color="blue" icon={<IconBluetooth size={20} />}>
        Web Bluetooth requires desktop or Android Chrome/Edge. Safari and Firefox do not support it.
      </Alert>
      <Group justify="flex-end" mt="xl">
        <Button rightSection={<IconArrowRight size={18} />} onClick={() => onNavigate('controller')}>
          Design the controller
        </Button>
      </Group>
    </Container>
  );
}
