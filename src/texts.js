// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the report of the Configuration action, command
// and scene action errors, the detection names of the trigger. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './blueiris/client.js';
import { DETECTIONS } from './blueiris/model.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object built by a function of the language. */
export const localized = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noHost: {
    en: 'Enter the address of your Blue Iris server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Blue Iris dans la configuration.",
    de: 'Gib die Adresse deines Blue-Iris-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Blue Iris en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.20 (no password in the address).',
    fr: "Adresse incomprise, ex. 192.168.1.20 (pas de mot de passe dans l'adresse).",
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20 (kein Passwort in der Adresse).',
    es: 'Dirección no válida, p. ej. 192.168.1.20 (sin contraseña en la dirección).',
  },
  noCredentials: {
    en: 'Enter the user name and password of a Blue Iris user in the configuration.',
    fr: "Saisissez le nom d'utilisateur et le mot de passe d'un utilisateur Blue Iris dans la configuration.",
    de: 'Gib Benutzername und Passwort eines Blue-Iris-Benutzers in der Konfiguration ein.',
    es: 'Introduzca el nombre de usuario y la contraseña de un usuario de Blue Iris en la configuración.',
  },
};

// One explanation per error kind (src/blueiris/client.js), shown in the
// connection status, the report and the command errors.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Blue Iris does not answer: check its address, its port and that its web server is on.',
    fr: 'Blue Iris ne répond pas : vérifiez son adresse, son port et que son serveur web est actif.',
    de: 'Blue Iris antwortet nicht: Prüfe Adresse, Port und ob sein Webserver läuft.',
    es: 'Blue Iris no responde: compruebe su dirección, su puerto y que su servidor web esté activo.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'User name or password refused: check them in the configuration.',
    fr: "Nom d'utilisateur ou mot de passe refusé : vérifiez-les dans la configuration.",
    de: 'Benutzername oder Passwort abgelehnt: Prüfe sie in der Konfiguration.',
    es: 'Nombre de usuario o contraseña rechazados: compruébelos en la configuración.',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'Password refused: stopped so Blue Iris does not ban Gladys. Fix it, then test the connection.',
    fr: 'Mot de passe refusé : arrêt pour que Blue Iris ne bannisse pas Gladys. Corrigez-le, puis testez la connexion.',
    de: 'Passwort abgelehnt: angehalten, damit Blue Iris Gladys nicht sperrt. Korrigiere es und teste die Verbindung.',
    es: 'Contraseña rechazada: detenido para que Blue Iris no bloquee a Gladys. Corríjala y pruebe la conexión.',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'This Blue Iris user is not allowed to do this: give it the right in Blue Iris.',
    fr: "Cet utilisateur Blue Iris n'a pas ce droit : accordez-le-lui dans Blue Iris.",
    de: 'Dieser Blue-Iris-Benutzer darf das nicht: Gib ihm das Recht in Blue Iris.',
    es: 'Este usuario de Blue Iris no tiene ese permiso: concédaselo en Blue Iris.',
  },
  [ERROR_KINDS.NO_API]: {
    en: 'No Blue Iris JSON interface at this address: check the address and the port (81 by default).',
    fr: "Pas d'interface JSON Blue Iris à cette adresse : vérifiez l'adresse et le port (81 par défaut).",
    de: 'Keine JSON-Schnittstelle von Blue Iris unter dieser Adresse: Prüfe Adresse und Port (Standard 81).',
    es: 'No hay interfaz JSON de Blue Iris en esta dirección: compruebe la dirección y el puerto (81 por defecto).',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'Blue Iris refused the command: see the integration logs.',
    fr: "Blue Iris a refusé la commande : voir les logs de l'intégration.",
    de: 'Blue Iris hat den Befehl abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'Blue Iris rechazó la orden: consulte los registros de la integración.',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Blue Iris answered with an error: see the integration logs.',
    fr: "Blue Iris a répondu par une erreur : voir les logs de l'intégration.",
    de: 'Blue Iris hat mit einem Fehler geantwortet: Sieh dir die Protokolle der Integration an.',
    es: 'Blue Iris respondió con un error: consulte los registros de la integración.',
  },
};

// Messages of the commands, the Configuration action and the scene actions.
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Configure the address, user name and password of Blue Iris first.',
    fr: "Configurez d'abord l'adresse, le nom d'utilisateur et le mot de passe de Blue Iris.",
    de: 'Konfiguriere zuerst Adresse, Benutzername und Passwort von Blue Iris.',
    es: 'Configure primero la dirección, el nombre de usuario y la contraseña de Blue Iris.',
  },
  notConnected: {
    en: 'Blue Iris is not connected yet: try again in a moment.',
    fr: "Blue Iris n'est pas encore connecté : réessayez dans un instant.",
    de: 'Blue Iris ist noch nicht verbunden: Versuche es gleich noch einmal.',
    es: 'Blue Iris aún no está conectado: inténtelo de nuevo en un momento.',
  },
  pickCamera: {
    en: 'Choose a Blue Iris camera added to Gladys.',
    fr: 'Choisissez une caméra Blue Iris ajoutée à Gladys.',
    de: 'Wähle eine Blue-Iris-Kamera, die zu Gladys hinzugefügt wurde.',
    es: 'Elija una cámara de Blue Iris añadida a Gladys.',
  },
  unknownCamera: {
    en: 'This camera is not (or no longer) a camera of the Blue Iris server.',
    fr: "Cette caméra n'est pas (ou plus) une caméra du serveur Blue Iris.",
    de: 'Diese Kamera gehört nicht (mehr) zum Blue-Iris-Server.',
    es: 'Esta cámara no es (o ya no es) una cámara del servidor Blue Iris.',
  },
  unknownProfile: {
    en: 'Unknown profile: give its number (0 to 7) or its name in Blue Iris.',
    fr: 'Profil inconnu : indiquez son numéro (0 à 7) ou son nom dans Blue Iris.',
    de: 'Unbekanntes Profil: Gib seine Nummer (0 bis 7) oder seinen Namen in Blue Iris an.',
    es: 'Perfil desconocido: indique su número (0 a 7) o su nombre en Blue Iris.',
  },
  disarmRefused: {
    en: 'Disarming from Gladys is off: allow it in the configuration of the integration first.',
    fr: "Le désarmement depuis Gladys est désactivé : autorisez-le d'abord dans la configuration de l'intégration.",
    de: 'Unscharfschalten aus Gladys ist aus: Erlaube es zuerst in der Konfiguration der Integration.',
    es: 'El desarmado desde Gladys está desactivado: autorícelo primero en la configuración de la integración.',
  },
  yellowRefused: {
    en: 'Yellow is a transition of Blue Iris: choose green (armed) or red (disarmed).',
    fr: 'Le jaune est une transition de Blue Iris : choisissez vert (armé) ou rouge (désarmé).',
    de: 'Gelb ist ein Übergang von Blue Iris: Wähle Grün (scharf) oder Rot (unscharf).',
    es: 'El amarillo es una transición de Blue Iris: elija verde (armado) o rojo (desarmado).',
  },
  noProfileRight: {
    en: 'This Blue Iris user may not change the profile or the signal: allow it in Blue Iris.',
    fr: 'Cet utilisateur Blue Iris ne peut pas changer de profil ni de signal : autorisez-le dans Blue Iris.',
    de: 'Dieser Blue-Iris-Benutzer darf Profil und Signal nicht ändern: Erlaube es in Blue Iris.',
    es: 'Este usuario de Blue Iris no puede cambiar el perfil ni la señal: autorícelo en Blue Iris.',
  },
  noPtz: {
    en: 'This camera has no PTZ, or this Blue Iris user may not move it.',
    fr: "Cette caméra n'a pas de PTZ, ou cet utilisateur Blue Iris ne peut pas la piloter.",
    de: 'Diese Kamera hat kein PTZ, oder dieser Blue-Iris-Benutzer darf sie nicht bewegen.',
    es: 'Esta cámara no tiene PTZ, o este usuario de Blue Iris no puede moverla.',
  },
  snapshotFailed: {
    en: 'Blue Iris did not send an image of this camera.',
    fr: "Blue Iris n'a pas envoyé d'image de cette caméra.",
    de: 'Blue Iris hat kein Bild dieser Kamera gesendet.',
    es: 'Blue Iris no envió ninguna imagen de esta cámara.',
  },
  armed: {
    en: 'Blue Iris armed (green).',
    fr: 'Blue Iris armé (vert).',
    de: 'Blue Iris scharf geschaltet (grün).',
    es: 'Blue Iris armado (verde).',
  },
  disarmed: {
    en: 'Blue Iris disarmed (red).',
    fr: 'Blue Iris désarmé (rouge).',
    de: 'Blue Iris unscharf geschaltet (rot).',
    es: 'Blue Iris desarmado (rojo).',
  },
  triggered: {
    en: 'Camera triggered.',
    fr: 'Caméra déclenchée.',
    de: 'Kamera ausgelöst.',
    es: 'Cámara activada.',
  },
};

// Report of the "Test the connection" action.
export const REPORT_TEXT = {
  en: {
    ok: (name, host, cameras, profile) =>
      `${name} at ${host}: ${cameras} camera(s), active profile "${profile}".`,
    rights: { admin: 'administrator', profile: 'may change profiles', read: 'read only' },
    user: (user, rights) => `User ${user}: ${rights}.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
  fr: {
    ok: (name, host, cameras, profile) =>
      `${name} à ${host} : ${cameras} caméra(s), profil actif « ${profile} ».`,
    rights: { admin: 'administrateur', profile: 'peut changer de profil', read: 'lecture seule' },
    user: (user, rights) => `Utilisateur ${user} : ${rights}.`,
    failed: (host, reason) => `${host} : ${reason}`,
  },
  de: {
    ok: (name, host, cameras, profile) =>
      `${name} unter ${host}: ${cameras} Kamera(s), aktives Profil „${profile}“.`,
    rights: { admin: 'Administrator', profile: 'darf Profile ändern', read: 'nur lesen' },
    user: (user, rights) => `Benutzer ${user}: ${rights}.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
  es: {
    ok: (name, host, cameras, profile) =>
      `${name} en ${host}: ${cameras} cámara(s), perfil activo «${profile}».`,
    rights: { admin: 'administrador', profile: 'puede cambiar de perfil', read: 'solo lectura' },
    user: (user, rights) => `Usuario ${user}: ${rights}.`,
    failed: (host, reason) => `${host}: ${reason}`,
  },
};

// `detection_name` of the camera_alert trigger and the widget rows.
export const DETECTION_NAMES = {
  en: {
    [DETECTIONS.PERSON]: 'Person',
    [DETECTIONS.VEHICLE]: 'Vehicle',
    [DETECTIONS.ANIMAL]: 'Animal',
    [DETECTIONS.MOTION]: 'Motion',
    [DETECTIONS.AUDIO]: 'Sound',
    [DETECTIONS.EXTERNAL]: 'External trigger',
    [DETECTIONS.OTHER]: 'Alert',
  },
  fr: {
    [DETECTIONS.PERSON]: 'Personne',
    [DETECTIONS.VEHICLE]: 'Véhicule',
    [DETECTIONS.ANIMAL]: 'Animal',
    [DETECTIONS.MOTION]: 'Mouvement',
    [DETECTIONS.AUDIO]: 'Son',
    [DETECTIONS.EXTERNAL]: 'Déclenchement externe',
    [DETECTIONS.OTHER]: 'Alerte',
  },
  de: {
    [DETECTIONS.PERSON]: 'Person',
    [DETECTIONS.VEHICLE]: 'Fahrzeug',
    [DETECTIONS.ANIMAL]: 'Tier',
    [DETECTIONS.MOTION]: 'Bewegung',
    [DETECTIONS.AUDIO]: 'Geräusch',
    [DETECTIONS.EXTERNAL]: 'Externer Auslöser',
    [DETECTIONS.OTHER]: 'Alarm',
  },
  es: {
    [DETECTIONS.PERSON]: 'Persona',
    [DETECTIONS.VEHICLE]: 'Vehículo',
    [DETECTIONS.ANIMAL]: 'Animal',
    [DETECTIONS.MOTION]: 'Movimiento',
    [DETECTIONS.AUDIO]: 'Sonido',
    [DETECTIONS.EXTERNAL]: 'Activación externa',
    [DETECTIONS.OTHER]: 'Alerta',
  },
};
