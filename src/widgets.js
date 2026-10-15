// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `blue_iris`.
//
// The use case: a glance at the wall tablet — "is the surveillance armed, in
// which profile, what happened today?" — and arming it on the way out. So the
// widget shows:
//   - tiles: the active profile, the shield (armed, arming, disarmed), the
//     cameras online (5/6) and the alerts over 24 hours;
//   - the last alerts, newest first, with what was seen and the image taken
//     when it happened (card-list, list display, its date under the title);
//   - buttons: "Arm" while not armed; "Disarm" only when the configuration
//     allows it, with a confirmation; "Trigger" for the camera chosen in the
//     widget settings. A user who may not change profiles sees no arm button.
// Every camera by default, or the one chosen in the widget settings.
//
// Budget (8 components, ≤ 2 texts, one focal component, ≤ 4 buttons): four
// tiles, one card-list or one caption, three buttons at most. Button action
// keys are unique (the core drops a duplicate). The alerts are kept in
// memory: after a restart the list holds the last 24 hours without images.
// Images: keys `al-<id>`, immutable, served by onWidgetGetImage from the hub.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from './blueiris/client.js';
import { SIGNALS } from './blueiris/model.js';
import { WIDGET_KEY } from './hub.js';
import { ACTION_TEXT, DETECTION_NAMES, ERROR_TEXT, pick } from './texts.js';

export const WIDGET_ACTIONS = Object.freeze({ ARM: 'arm', DISARM: 'disarm', TRIGGER: 'trigger' });

export const TEXT = {
  configure: {
    en: 'Enter the address, user name and password of Blue Iris in the configuration of the integration.',
    fr: "Saisissez l'adresse, le nom d'utilisateur et le mot de passe de Blue Iris dans la configuration de l'intégration.",
    de: 'Gib Adresse, Benutzername und Passwort von Blue Iris in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección, el nombre de usuario y la contraseña de Blue Iris en la configuración de la integración.',
  },
  unknown: {
    en: 'This camera is no longer in Blue Iris: choose another one in the widget settings.',
    fr: "Cette caméra n'est plus dans Blue Iris : choisissez-en une autre dans les réglages du widget.",
    de: 'Diese Kamera ist nicht mehr in Blue Iris: Wähle eine andere in den Widget-Einstellungen.',
    es: 'Esta cámara ya no está en Blue Iris: elija otra en la configuración del widget.',
  },
  noAlert: {
    en: 'No alert in the last 24 hours.',
    fr: 'Aucune alerte depuis 24 heures.',
    de: 'Kein Alarm in den letzten 24 Stunden.',
    es: 'Ninguna alerta en las últimas 24 horas.',
  },
  profile: { en: 'Profile', fr: 'Profil', de: 'Profil', es: 'Perfil' },
  shield: { en: 'Surveillance', fr: 'Surveillance', de: 'Überwachung', es: 'Vigilancia' },
  armed: { en: 'Armed', fr: 'Armée', de: 'Scharf', es: 'Armada' },
  arming: { en: 'Arming', fr: 'Armement', de: 'Wird scharf', es: 'Armando' },
  disarmed: { en: 'Disarmed', fr: 'Désarmée', de: 'Unscharf', es: 'Desarmada' },
  online: {
    en: 'Cameras online',
    fr: 'Caméras en ligne',
    de: 'Kameras online',
    es: 'Cámaras en línea',
  },
  alerts: { en: 'Alerts 24 h', fr: 'Alertes 24 h', de: 'Alarme 24 h', es: 'Alertas 24 h' },
  arm: { en: 'Arm', fr: 'Armer', de: 'Scharf schalten', es: 'Armar' },
  disarm: { en: 'Disarm', fr: 'Désarmer', de: 'Unscharf', es: 'Desarmar' },
  trigger: { en: 'Trigger', fr: 'Déclencher', de: 'Auslösen', es: 'Activar' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const SHIELD = {
  [SIGNALS.GREEN]: { text: TEXT.armed, color: WIDGET_COLORS.SUCCESS, icon: 'shield' },
  [SIGNALS.YELLOW]: { text: TEXT.arming, color: WIDGET_COLORS.WARNING, icon: 'shield' },
  [SIGNALS.RED]: { text: TEXT.disarmed, color: WIDGET_COLORS.DANGER, icon: 'shield-off' },
};

/** "Person · Front door" — what was seen, and where. */
export function alertTitle(alert, cameraName, language) {
  const what = pick(DETECTION_NAMES, language)[alert.kind] ?? pick(DETECTION_NAMES, language).other;
  return fit(`${what} · ${cameraName}`, 60);
}

async function get(hub, { settings, language = 'en' }) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.configure, language);
  }
  let shown = view.cameras;
  let chosen = null;
  if (settings?.camera) {
    chosen = view.cameras.find((camera) => camera.externalId === settings.camera);
    if (!chosen) {
      return message(TEXT.unknown, language);
    }
    shown = [chosen];
  }
  const components = [];
  if (!view.online) {
    const kind = view.error?.kind === ERROR_KINDS.AUTH ? ERROR_KINDS.BLOCKED : view.error?.kind;
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(ERROR_TEXT[kind] ?? ERROR_TEXT[ERROR_KINDS.UNREACHABLE], language), 80),
    });
  }

  const status = view.online ? view.status : null;
  if (status?.profile !== null && status?.profile !== undefined) {
    components.push({
      type: 'value',
      value: fit(view.profileName(status.profile, language), 12),
      label: t(TEXT.profile, language),
      icon: 'layers',
    });
  }
  const shield = SHIELD[status?.signal];
  if (shield) {
    components.push({
      type: 'value',
      value: fit(t(shield.text, language), 12),
      label: t(TEXT.shield, language),
      icon: shield.icon,
      color: shield.color,
    });
  }
  const onlineCount = shown.filter((camera) => camera.online).length;
  components.push(
    {
      type: 'value',
      value: `${onlineCount}/${shown.length}`,
      label: t(TEXT.online, language),
      icon: 'video',
      color: onlineCount === shown.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
    {
      type: 'value',
      value: view.alertsToday(chosen?.short),
      label: t(TEXT.alerts, language),
      icon: 'bell',
    },
  );

  const names = new Map(view.cameras.map((camera) => [camera.short, camera.name]));
  const alerts = view.alerts
    .filter((alert) => !chosen || alert.short === chosen.short)
    .filter((alert) => names.has(alert.short));
  if (alerts.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: alerts.slice(0, 8).map((alert) => ({
        title: alertTitle(alert, names.get(alert.short), language),
        date: new Date(alert.at).toISOString(),
        ...(alert.imageKey ? { image: alert.imageKey } : {}),
      })),
    });
  } else if (view.online) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.noAlert, language) });
  }

  if (view.online && view.rights.changeProfile) {
    if (status?.signal !== SIGNALS.GREEN) {
      components.push({
        type: 'button',
        label: t(TEXT.arm, language),
        icon: 'shield',
        style: 'primary',
        action: { key: WIDGET_ACTIONS.ARM },
      });
    } else if (view.allowDisarm) {
      components.push({
        type: 'button',
        label: t(TEXT.disarm, language),
        icon: 'shield-off',
        style: 'danger',
        action: { key: WIDGET_ACTIONS.DISARM, confirm: true },
      });
    }
  }
  if (view.online && chosen) {
    components.push({
      type: 'button',
      label: t(TEXT.trigger, language),
      icon: 'zap',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.TRIGGER, params: { camera: chosen.externalId } },
    });
  }
  // Alerts and commands nudge the widget (requestWidgetRefresh); the TTL is a net.
  return { ttl_seconds: 60, components };
}

/** A widget button: arm, disarm (only when allowed), trigger a camera. */
async function action(hub, { actionKey, params = {} }) {
  switch (actionKey) {
    case WIDGET_ACTIONS.ARM:
      await hub.setSignal(SIGNALS.GREEN);
      return ACTION_TEXT.armed;
    case WIDGET_ACTIONS.DISARM:
      await hub.setSignal(SIGNALS.RED);
      return ACTION_TEXT.disarmed;
    case WIDGET_ACTIONS.TRIGGER:
      await hub.triggerCamera(params.camera);
      return ACTION_TEXT.triggered;
    default:
      throw new Error(`Unknown widget action ${actionKey}`);
  }
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
