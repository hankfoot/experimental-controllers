import { Button, Card, Container, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconArrowRight, IconExternalLink } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import type { PageId } from '../App';

interface HomePageProps {
  onNavigate(page: PageId): void;
}

const cards: Array<{ page: PageId; number: number; title: string; text: string; color: string }> = [
  { page: 'setup', number: 1, title: 'Set up', text: 'Connect your micro:bit to the browser.', color: 'red' },
  { page: 'controller', number: 2, title: 'Build', text: 'Choose inputs and generate controller code.', color: 'yellow' },
  { page: 'game', number: 3, title: 'Play', text: 'Wire those inputs to the game and experiment.', color: 'green' },
];

export function HomePage({ onNavigate }: HomePageProps) {
  return (
    <Container size="lg" py={{ base: 48, sm: 80 }}>
      <Stack align="center" ta="center" gap="md" className="hero">
        <BrandMark size={88} />
        <Text tt="uppercase" fw={700} c="blue" size="sm" lts="0.12em">Fidget Camp 2026 · Workshop</Text>
        <Title order={1}>Turn anything into a game controller</Title>
        <Text c="dimmed" size="lg">
          Build delightfully ridiculous ways to play using a micro:bit, Bluetooth, and whatever
          objects you can find.
        </Text>
        <Text size="sm">
          with Avi Romanoff & Hank Duhaime{' '}
          <a href="https://www.instagram.com/schmardware/" target="_blank" rel="noreferrer">@schmardware</a>
        </Text>
        <Group mt="sm">
          <Button size="lg" rightSection={<IconArrowRight size={18} />} onClick={() => onNavigate('setup')}>
            Get started
          </Button>
          <Button
            component="a"
            href="https://docs.google.com/presentation/d/1aG_TYwTnf5ykXEjPiB-F1syKZAWkMWPhGqWRq1tN1R0/edit"
            target="_blank"
            rel="noreferrer"
            variant="default"
            size="lg"
            rightSection={<IconExternalLink size={18} />}
          >
            Workshop slides
          </Button>
        </Group>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mt={{ base: 48, sm: 72 }}>
        {cards.map((card) => (
          <Card
            key={card.page}
            component="button"
            type="button"
            className="journey-card"
            radius="lg"
            padding="lg"
            withBorder
            onClick={() => onNavigate(card.page)}
          >
            <Text c={card.color} fw={800} size="xl">{card.number}</Text>
            <Title order={3} mt="xs">{card.title}</Title>
            <Text c="dimmed" mt="xs">{card.text}</Text>
          </Card>
        ))}
      </SimpleGrid>
    </Container>
  );
}
