for (const key of Object.keys(process.env)) {
  if (key.startsWith('ZIMI_CODE_')) {
    delete process.env[key];
  }
}

process.env['ZIMI_CODE_SEARCH_WORKER'] = 'false';

process.env['ZIMI_CODE_PERSISTENCE_MINIDB_READMODEL'] = 'false';
