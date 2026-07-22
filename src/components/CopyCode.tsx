import { ActionIcon, Box, CopyButton, Paper, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

interface CopyCodeProps {
  code: string;
}

export function CopyCode({ code }: CopyCodeProps) {
  return (
    <Paper className="code-panel" radius="md" withBorder>
      <Box className="code-scroll"><code>{code}</code></Box>
      <CopyButton value={code} timeout={1400}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copied' : 'Copy code'}>
            <ActionIcon
              className="code-copy"
              aria-label="Copy code"
              color={copied ? 'teal' : 'gray'}
              variant="filled"
              onClick={copy}
            >
              {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Paper>
  );
}
