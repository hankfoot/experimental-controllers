import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowRight, IconBolt } from '@tabler/icons-react';
import { CopyCode } from '../components/CopyCode';
import type { PageId } from '../App';
import {
  CONTROLLER_INPUTS,
  generateControllerCode,
  INPUT_SECTIONS,
  inputVariant,
  streamingLineCount,
  type BuilderState,
  type ControllerInput,
} from '../domain/builder';

interface ControllerPageProps {
  state: BuilderState;
  onChange(state: BuilderState): void;
  onNavigate(page: PageId): void;
}

function InputCard({ input, state, onChange }: Omit<ControllerPageProps, 'onNavigate'> & { input: ControllerInput }) {
  const selected = state.selected.has(input.id);
  const variant = inputVariant(input, state.pinModes);
  const toggle = () => {
    const next = new Set(state.selected);
    selected ? next.delete(input.id) : next.add(input.id);
    onChange({ ...state, selected: next });
  };

  return (
    <Card className="input-card" data-selected={selected} radius="md" padding="md" withBorder>
      <Group align="flex-start" wrap="nowrap">
        <Text fz={28} lh={1}>{input.emoji}</Text>
        <div style={{ flex: 1 }}>
          <Checkbox label={input.name} checked={selected} fw={700} onChange={toggle} />
          <Text c="dimmed" size="sm" mt={5}>{input.description}</Text>
          <Group gap={4} mt="xs">
            {variant.channels.map((channel) => <Badge key={channel} variant="light" color="gray">{channel}</Badge>)}
          </Group>
        </div>
      </Group>
      {input.modes && (
        <Select
          mt="sm"
          size="xs"
          label="Use pin as"
          value={state.pinModes[input.id]}
          data={Object.entries(input.modes).map(([value, mode]) => ({ value, label: mode.label ?? value }))}
          onChange={(mode) => {
            if (!mode) return;
            const next = new Set(state.selected).add(input.id);
            onChange({ selected: next, pinModes: { ...state.pinModes, [input.id]: mode } });
          }}
        />
      )}
    </Card>
  );
}

export function ControllerPage({ state, onChange, onNavigate }: ControllerPageProps) {
  const code = generateControllerCode(state);
  const streamCount = streamingLineCount(state);
  const selectedInputs = CONTROLLER_INPUTS.filter((input) => state.selected.has(input.id));

  return (
    <Container size="lg" py="xl">
      <Title order={1}>Design your controller</Title>
      <Text c="dimmed" size="lg" mt="xs" mb="xl">
        Choose the physical inputs you want. We’ll generate the MakeCode and make them available on the Game page.
      </Text>

      <Stack gap={36}>
        <section>
          <Title order={2} size="h3" mb="lg"><span className="inline-step">1</span> Choose inputs</Title>
          <Stack gap="xl">
            {INPUT_SECTIONS.map((section) => (
              <div key={section.id}>
                <Title order={3} size="h4">{section.title}</Title>
                <Text c="dimmed" size="sm" mb="sm">{section.description}</Text>
                <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
                  {section.inputs.map((input) => (
                    <InputCard key={input.id} input={input} state={state} onChange={onChange} />
                  ))}
                </SimpleGrid>
              </div>
            ))}
          </Stack>
          {streamCount >= 5 && (
            <Alert mt="lg" color={streamCount >= 8 ? 'orange' : 'yellow'} icon={<IconBolt size={20} />}>
              <strong>{streamCount} live readings</strong> will stream ten times per second. Uncheck unused
              inputs if controls feel laggy; gestures send only when they happen.
            </Alert>
          )}
        </section>

        <section>
          <Title order={2} size="h3" mb="lg"><span className="inline-step">2</span> Flash this code</Title>
          <Text mb="sm">Replace everything in MakeCode’s JavaScript tab, then click Download.</Text>
          <CopyCode code={code} />
        </section>

        <section>
          <Title order={2} size="h3" mb="lg"><span className="inline-step">3</span> Build the object</Title>
          <Paper radius="md" p="lg" withBorder>
            {selectedInputs.length === 0 ? (
              <Text c="dimmed">Choose an input above to see build ideas.</Text>
            ) : (
              <Stack gap="sm">
                {selectedInputs.map((input) => {
                  const variant = inputVariant(input, state.pinModes);
                  return (
                    <Text key={input.id}>
                      <strong>{input.emoji} {input.name}{variant.label ? ` · ${variant.label}` : ''}:</strong>{' '}
                      {variant.build}
                    </Text>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </section>
      </Stack>

      <Group justify="flex-end" mt="xl">
        <Button rightSection={<IconArrowRight size={18} />} onClick={() => onNavigate('game')}>
          Wire it to the game
        </Button>
      </Group>
    </Container>
  );
}
