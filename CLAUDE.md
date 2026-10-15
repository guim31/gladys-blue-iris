# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/app.js registers the handlers before connect()
src/app.js                        every SDK handler -> the hub (also used by the tests)
src/hub.js                        the server: timers, states, alerts and their trigger, images, commands, logs
src/devices.js                    Gladys devices (server + one per camera), feature names (4 languages), values
src/blueiris/client.js            JSON interface: MD5 login, session renewal, no retry of a refused password, images
src/blueiris/http.js              the HTTP seam (node:http/https), replaced by the fake server in tests
src/blueiris/model.js             what the answers mean: status, camlist, alertlist (flags, AI memo), ptz, rights
src/image.js                      camera image <= 150 KB: asks Blue Iris for smaller sizes, decodes nothing
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/widgets.js                    dashboard widget `blue_iris` (manifest `widgets`)
src/texts.js                      status, error, report, command and detection texts (4 languages)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                      /data/blue-iris-state.json (server identity, cameras, presets, AI seen)
scripts/probe.mjs                 read-only probe of a real server (not in the image)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (en and fr mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
                                  and helpers/fakeBlueIris.js (built from test/fixtures/blueiris)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish: action
  messages, widget content, feature names, manifest texts, and
  `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync
  (`test/i18n.test.js` checks the languages and the doc sections).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM public.ecr.aws/docker/library/node:…` (miroir officiel ECR Public, même
  empreinte) et non `node:…` de Docker Hub, qui refuse en 429 les pulls anonymes des runners GitHub
  dès qu'il y a plusieurs builds à la fois. Un échec 429 dans le job « Docker build » n'est pas un bug
  du code. Même parade dans `.github/workflows/build.yml` (posée par l'orchestrateur, ne pas la
  retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## Blue Iris : l'API et les pièges de cette intégration

Sources : l'interface web UI3 livrée avec Blue Iris (`bp2008/ui3`, LGPL-3.0 : lue, jamais copiée),
`kramttocs/ha-blueiris` (Apache-2.0, commit 7625752 du 02/10/2026) et `elad-bar/ha-blueiris` (sans
licence : lu seulement). Aucun serveur Blue Iris n'a été testé : `scripts/probe.mjs` est à lancer par
l'orchestrateur sur un vrai serveur (il affiche les noms des champs de chaque réponse).

- **Connexion** : `POST /json`. `{ cmd: "login" }` répond `result: "fail"` avec une `session` (raison
  « missing response ») : c'est le défi, pas une erreur. Puis `response = md5("user:session:password")`.
  Une session expirée répond `fail` « Invalid session » (sans raison avant 5.8.1.1) : se reconnecter
  **une** fois. Un second login refusé = mauvais mot de passe : arrêt (`blocked`), jamais de boucle,
  Blue Iris bannit l'adresse après quelques échecs (« auto-ban »). La session vaut le mot de passe :
  jamais dans un journal (un test le vérifie).
- **Droits** (données du login, comme UI3) : `admin`, `changeprofile` (défaut = `admin`), `ptz`
  (défaut vrai). Un simple utilisateur avec « changer de profil » suffit pour armer ; `trigger` exige
  un administrateur.
- **status** : `signal` "0" rouge, "1" vert, "2" jaune (transition d'armement : UI3 envoie 2 en
  armant ; ici on envoie 1, non vérifié) ; `profile` 0-7, le 0 « Inactive » ne déclenche rien ;
  `lock` 0 le planning tourne, 1 tenu, 2 temporaire. **Un profil envoyé une fois est temporaire,
  envoyé deux fois il est tenu** (logique des intégrations HA : renvoyer si `lock !== 1`). `disks` en
  **Mio** (`allocated`, `used`, `free`) ; vieux serveurs : texte `clips` « …, 1.2T/2.0T; ».
- **camlist** : `index` (toutes les caméras) et `@index` (cycle) sont des entrées système, une entrée
  avec `group` est un groupe : écartés. `optionValue` = nom court, l'identifiant de toutes les
  commandes (et de l'`external_id`). `alertutc` (epoch s de la dernière alerte) dit quand lire
  `alertlist`.
- **alertlist** (`camera` = nom court ou `index`, `view: "alerts"`, `startdate`/`enddate` en epoch s) :
  `flags` de UI3 (`BIDBFLAG`) : mouvement 1<<17, audio 1<<19, externe 1<<20, annulée 1<<23,
  IA personne 1<<26, IA véhicule 1<<27, confirmée 1<<28 ; `memo` « person:87%,car:62% ». Au démarrage,
  les alertes des 24 h servent de référence (rien ne se déclenche) ; une caméra apparue ensuite aussi.
- **PTZ** : boutons 0 gauche, 1 droite, 2 haut, 3 bas, 4 home, 5 zoom +, 6 zoom −, 64 stop, 101-120
  positions. Un bouton sans `updown` est une action « sûre » (presets) ; `updown: 1` démarre un
  mouvement continu, `updown: 0` l'arrête. Le cœur exige un chien de garde : 2 s ici, arrêt réessayé
  une fois, arrêt de tout mouvement à l'extinction. Les presets viennent de `{ cmd: "ptz", camera }`
  (`presetnum`, `presets` en noms ou `{ num, desc }`).
- **Images** : `/image/<court>?w=&q=&session=` ; Blue Iris redimensionne lui-même, donc aucune
  bibliothèque d'image : redemander plus petit jusqu'à 150 Ko. Une page HTML de login en 200 = session
  expirée.
- **Le validateur d'image de widget du SDK lit l'en-tête SOF du JPEG** : un faux JPEG de test doit
  avoir un vrai segment SOF0, pas seulement `FF D8`.
- **`text/select` avec valeurs texte** : profil "0".."7" et signal `green`/`yellow`/`red` (le cœur
  n'accepte les valeurs texte que sur `text/select`). L'état se publie `{ text }`.
- **Désarmer n'est jamais un interrupteur** : signal rouge, profil 0 et profils listés dans
  `disarmed_profiles` refusés tant que `allow_disarm` est faux, par la fonctionnalité, l'action de
  scène et le widget (bouton « Désarmer » avec confirmation seulement si autorisé).
- Pas d'événements poussés : Blue Iris les pousse par MQTT ou appel web, que le conteneur en pont ne
  reçoit pas. D'où la lecture toutes les 10 s par défaut (serveur local, sans quota).
- Le faux Gladys enregistre les transports sous `device_external_id`, pas `external_id`.
