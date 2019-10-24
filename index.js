const fs = require('fs-extra');
const inquirer = require('inquirer');
const uniqBy = require('lodash/uniqBy');
const ora = require('ora');
const puppeteer = require('puppeteer');
const UserAgent = require('user-agents');

(async () => {
  const { password, username } = await inquirer.prompt([
    {
      message: `What's your Google Music username?`,
      name: 'username',
      type: 'input',
    },
    {
      message: `What's your Google Music password`,
      name: 'password',
      type: 'password',
    },
  ]);

  const spinner = ora('Logging into Google Music').start();

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const { userAgent, viewportHeight, viewportWidth } = new UserAgent({
    deviceCategory: 'desktop',
  });

  await page.setViewport({ height: viewportHeight, width: viewportWidth });
  await page.setUserAgent(userAgent);

  await page.goto('https://play.google.com/music/listen');

  // Landing

  const landingNextSelector = '[role="button"][data-action="signin"]';

  await page.waitForSelector(landingNextSelector);
  await page.click(landingNextSelector);

  // Login > Identifier

  const identifierInputSelector = 'input[autocomplete="username"]';

  await page.waitForSelector(identifierInputSelector);
  await page.type(identifierInputSelector, username);
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  // Login > Password

  const passwordInputSelector = 'input[autocomplete="current-password"]';

  await page.waitForSelector(passwordInputSelector);
  await page.type(passwordInputSelector, password);
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });

  // Home

  await page.waitForSelector('#splash-screen');
  await page.waitForSelector('#splash-screen', { hidden: true });
  await page.waitForSelector('#loading-overlay');
  await page.waitForSelector('#loading-overlay', { hidden: true });

  spinner.text = 'Finding playlists';

  await page.goto('https://play.google.com/music/listen#/wmp');

  // Music Library

  await page.waitForSelector(
    '.material-card.draggable[data-type="pl"][data-id]',
  );
  const playlistsSummaries = uniqBy(
    await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(
          '.material-card.draggable[data-type="pl"][data-id]',
        ),
      ).map(el => ({
        id: el.dataset.id,
        title: el.querySelector('.title').textContent,
      }));
    }),
    'id',
  );

  // Playlist

  let playlists = [];
  for (const [index, { id, title }] of playlistsSummaries.entries()) {
    spinner.text = `(${index + 1}/${
      playlistsSummaries.length
    }) Finding songs for "${title}"`;

    await page.goto(`https://play.google.com/music/listen?u=0#/pl/${id}`);
    await page.waitForSelector(`h2[title="${title}"]`);
    const songs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('tr'))
        .map(row =>
          Array.from(row.querySelectorAll('td'))
            .map(column => column.textContent.trim())
            .filter(Boolean),
        )
        .filter(row => row.length > 0)
        .map(([number, title, duration, artist, album, playCount]) => ({
          album,
          artist,
          duration,
          number,
          playCount,
          title,
        }));
    });

    playlists.push({ id, songs, title });
  }

  await browser.close();

  // Ouput

  spinner.text = 'Writing report';

  const reportTimestamp = Date.now();
  await fs.writeFile(
    `./report-${reportTimestamp}.tsv`,
    [
      [
        'Playlist ID',
        'Playlist Title',
        'Song Index',
        'Song Title',
        'Song Duration',
        'Artist Name',
        'Album Name',
        'Play Count',
      ].join('\t'),
      ...playlists.flatMap(playlist =>
        playlist.songs.map(song =>
          [
            playlist.id,
            playlist.title,
            song.number,
            song.title,
            song.duration,
            song.artist,
            song.album,
            song.playCount,
          ].join('\t'),
        ),
      ),
    ].join('\n'),
  );

  spinner.stop();

  process.exit(0);
})();
