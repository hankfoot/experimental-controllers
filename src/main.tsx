import '@mantine/core/styles.css';
import './styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const theme = createTheme({
  primaryColor: 'blue',
  fontFamily: 'Outfit, system-ui, sans-serif',
  headings: { fontFamily: 'Outfit, system-ui, sans-serif', fontWeight: '750' },
  defaultRadius: 'md',
  colors: {
    blue: ['#eef4ff', '#dce7ff', '#b8ceff', '#8dafFF', '#6090ff', '#3d78ff', '#2f6bff', '#2255da', '#1946b8', '#173e91'],
  },
});

createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} defaultColorScheme="light">
    <App />
  </MantineProvider>,
);
