try {
  await import('./restore-media.mjs');
  const { prepareImages } = await import('./prepare-instagram-assets.mjs');
  const count = await prepareImages();
  console.log(`${count} imagens JPEG preparadas para publicação no Instagram.`);
} catch {
  console.error('Não foi possível preparar o acervo. Confira as mídias locais, o deployment público e as dependências.');
  process.exitCode = 1;
}
