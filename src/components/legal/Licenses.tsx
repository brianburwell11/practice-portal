import { LegalPage, Mail, Section } from './LegalPage';
import packages from './thirdPartyLicenses.json';

const CONTACT = 'legal@practiceportal.app';
const SOUNDTOUCH_SOURCE = 'https://github.com/cutterbl/SoundTouchJS';

const link = 'text-blue-400 hover:text-blue-300';

/**
 * /legal/licenses. The open source code the browser runs, with its licenses.
 * The package list and the full texts are generated from package-lock.json by
 * `scripts/gen-licenses.ts`; the notes above the list are written by hand.
 */
export function Licenses() {
  const soundtouch = packages.filter((p) => p.name.startsWith('@soundtouchjs/'));

  return (
    <LegalPage title="Licenses">
      <p>
        Practice Portal is built on open source software. The code your browser runs includes the packages listed
        below, each under its own license. The{' '}
        <a href="/third-party-licenses.txt" className={link}>full license texts</a>, with each package’s copyright
        notice, are in one file. Questions go to <Mail to={CONTACT} />.
      </p>

      <Section title="SoundTouch (LGPL 2.1)">
        <p>
          Changing a song’s speed without changing its pitch uses SoundTouchJS
          ({soundtouch.map((p) => `${p.name} ${p.version}`).join(', ')}), under the GNU Lesser General Public License,
          version 2.1. We use it unmodified. Its source code is at{' '}
          <a href={SOUNDTOUCH_SOURCE} className={link}>{SOUNDTOUCH_SOURCE.replace('https://', '')}</a>, and we’ll
          send you a copy of the exact version we use if you email us.
        </p>
        <p>
          It loads as its own files (<code className="text-gray-100">/soundtouch-processor.js</code> and a separate
          script), so it can be swapped for a modified version without touching the rest of the app.
        </p>
      </Section>

      <Section title="Fonts">
        <p>
          Hanken Grotesk is used under the SIL Open Font License 1.1. We host it ourselves; your browser doesn’t fetch
          it from Google.
        </p>
      </Section>

      <Section title="Packages in the app">
        <p>JSZip is offered under a choice of MIT or GPL 3.0; we use it under the MIT license.</p>
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400">
              <tr className="border-b border-gray-800">
                <th className="px-3 py-2 font-medium">Package</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">License</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={`${p.name}@${p.version}`} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <a href={p.url} className={link}>{p.name}</a>
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{p.version}</td>
                  <td className="px-3 py-1.5 text-gray-400">{p.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="On our servers">
        <p>
          Uploads are converted on our servers with FFmpeg (audio) and MuseScore (MuseScore files to MusicXML). Both
          are open source and run only there; neither is part of what your browser downloads.
        </p>
      </Section>
    </LegalPage>
  );
}
