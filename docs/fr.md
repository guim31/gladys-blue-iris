# Blue Iris

## Présentation

Cette intégration relie Gladys à **Blue Iris**, le logiciel de vidéosurveillance pour Windows, par
son interface JSON locale (celle de sa propre interface web). Rien ne passe par un cloud.

- un appareil par caméra : son image, si elle est en ligne, voit du mouvement ou est déclenchée, et la
  personne ou le véhicule confirmés par l'IA de Blue Iris si vous en utilisez une ;
- un appareil serveur Blue Iris : profil actif, signal d'armement (vert, jaune, rouge), charge CPU et
  stockage des enregistrements ;
- des commandes : changer de profil, armer, déclencher une caméra, orienter une caméra PTZ ou
  l'envoyer sur une position mémorisée. Le désarmement est désactivé par défaut, comme pour une
  alarme ;
- un déclencheur de scène « Alerte sur une caméra Blue Iris », avec ce qui a été vu, et un widget de
  tableau de bord.

> **Developed without the hardware: feedback welcome.** Cette intégration a été écrite d'après la
> documentation de l'interface JSON de Blue Iris et d'autres intégrations, sans serveur Blue Iris
> sous la main. Dites ce qui marche et ce qui ne marche pas dans les
> [issues](https://github.com/guim31/gladys-blue-iris/issues).

Cette intégration n'est pas affiliée à Perspective Software, l'éditeur de Blue Iris.

## Prérequis

- Blue Iris 5 ou plus récent, avec son **serveur web** actif (Paramètres → Serveur web), joignable
  depuis Gladys (port 81 par défaut).
- Un **utilisateur Blue Iris dédié** à Gladys (Paramètres → Utilisateurs), avec un mot de passe :
  - un simple utilisateur (non administrateur) suffit pour lire les caméras, le profil et les alertes ;
  - autorisez-le à **changer de profil** pour armer et changer de profil depuis Gladys ;
  - autorisez-lui le **PTZ** pour orienter les caméras ;
  - déclencher une caméra demande un **administrateur** dans Blue Iris.
- Si le serveur web limite l'accès (« Non-LAN only », bannissement automatique), l'adresse de Gladys
  est sur le réseau local : rien à changer. Blue Iris peut bannir une adresse après quelques mauvais
  mots de passe ; l'intégration s'arrête au premier refus.

## Configuration

Dans Gladys, **Intégrations → Blue Iris → Configuration** :

| Réglage                                    | Rôle                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Adresse du serveur**                     | Adresse IP ou nom du PC Windows qui fait tourner Blue Iris, ex. `192.168.1.20`.                                                                  |
| **Port du serveur web**                    | 81, sauf si vous l'avez changé dans Blue Iris. Un port écrit dans l'adresse l'emporte.                                                           |
| **HTTPS**                                  | Seulement si le serveur web de Blue Iris sert du HTTPS sur ce port. Son certificat n'est pas vérifié.                                            |
| **Nom d'utilisateur** / **Mot de passe**   | L'utilisateur Blue Iris dédié. Le mot de passe n'est envoyé qu'à Blue Iris.                                                                      |
| **Rafraîchissement**                       | Fréquence de lecture de Blue Iris (5 s à 1 min, 10 s par défaut) : mouvements, déclenchements et alertes sont vus à ce rythme.                   |
| **Images des caméras**                     | Fréquence de rafraîchissement de l'image des caméras ajoutées (ou « Seulement sur alerte »). Une alerte en envoie toujours une neuve.            |
| **Garder le profil choisi**                | Activé (défaut) : un profil choisi depuis Gladys reste, le planning de Blue Iris ne le change plus. Désactivé : jusqu'à son prochain changement. |
| **Autoriser le désarmement depuis Gladys** | Désactivé par défaut. Voir ci-dessous.                                                                                                           |
| **Autres profils désarmés**                | Profils où vos caméras ne surveillent pas (ex. `Maison`), par nom ou numéro, séparés par des virgules.                                           |
| **Langue des noms**                        | Langue des noms de fonctionnalités et des textes envoyés aux scènes. Les noms sont fixés à l'ajout d'un appareil.                                |

Puis **Tester la connexion** : le rapport donne le serveur, le nombre de caméras, le profil actif et
les droits de l'utilisateur. Ouvrez l'onglet **Découverte** et ajoutez le serveur et les caméras
voulues.

**Armement et désarmement.** L'armement (signal vert, tout profil qui surveille) est toujours permis.
Le désarmement — le signal rouge, le profil 0 « Inactive » (où les caméras Blue Iris ne se déclenchent
pas), ou un profil listé dans **Autres profils désarmés** — est refusé tant que vous n'activez pas
**Autoriser le désarmement depuis Gladys** : un désarmement envoyé par erreur laisse les caméras
aveugles. Le désarmement n'est jamais un interrupteur : ni un assistant vocal ni un bouton du tableau
de bord ne peut le faire par accident.

## Appareils

### Serveur Blue Iris

| Fonctionnalité        | Signification                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **En ligne**          | Blue Iris répond.                                                                                                |
| **Profil**            | Le profil actif (0 à 7, avec les noms de Blue Iris). Une commande : choisissez-en un autre.                      |
| **Signal d'armement** | **Armé (vert)**, **Armement (jaune)** ou **Désarmé (rouge)**. Une commande : vert arme, rouge désarme si permis. |
| **Charge CPU**        | Charge CPU du serveur, en %.                                                                                     |
| **Stockage utilisé**  | Remplissage du stockage des enregistrements de Blue Iris, en %.                                                  |
| **Espace libre**      | Espace libre des disques d'enregistrement, en Go.                                                                |

Profil et signal sont en lecture seule pour un utilisateur qui ne peut pas changer de profil.

### Caméras

Un appareil par caméra de Blue Iris (les groupes et la vue « toutes les caméras » sont écartés),
nommé comme dans Blue Iris :

| Fonctionnalité         | Signification                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Image**              | L'image de la caméra, dans la boîte caméra du tableau de bord.                                                           |
| **En ligne**           | La caméra est activée et reçoit la vidéo.                                                                                |
| **Mouvement**          | Blue Iris voit du mouvement.                                                                                             |
| **Déclenchée**         | La caméra est déclenchée (enregistrement, alertes selon ses réglages).                                                   |
| **Personne**           | Une alerte a confirmé une personne (IA). Apparaît dès que Blue Iris en a signalé une.                                    |
| **Véhicule**           | Une alerte a confirmé un véhicule (IA). Apparaît dès que Blue Iris en a signalé un.                                      |
| **Orientation (PTZ)**  | Caméras PTZ : les flèches et le zoom de la boîte caméra du tableau de bord. Un mouvement s'arrête seul après 2 secondes. |
| **Position mémorisée** | Caméras PTZ avec positions : aller sur une position mémorisée dans Blue Iris.                                            |

**Personne** et **Véhicule** restent actifs au moins 30 secondes après l'alerte, puis tant que la
caméra est déclenchée. Ils apparaissent dans l'onglet Découverte (« Mettre à jour ») la première fois
que l'IA de Blue Iris en signale un ; les alertes des dernières 24 heures sont lues au démarrage pour
cela. Les étiquettes de l'IA (CodeProject.AI, DeepStack…) sont lues dans le mémo de l'alerte :
`person`, `car`, `truck`, `bus`, `motorcycle`, `bicycle`…

## Widget du tableau de bord

Le widget **Blue Iris** affiche, pour toutes les caméras ou celle choisie dans ses réglages :

- le profil actif, **Armée** / **Armement** / **Désarmée**, les caméras en ligne et les alertes sur 24
  heures ;
- les dernières alertes avec ce qui a été vu et l'image prise à ce moment ;
- un bouton **Armer** tant que la surveillance n'est pas armée ; **Désarmer** seulement une fois
  autorisé dans la configuration, avec une confirmation ; **Déclencher** pour la caméra choisie.

## Déclencheur de scène

**Alerte sur une caméra Blue Iris** : Blue Iris a levé une alerte sur une caméra. Filtres : la caméra,
et **Ce qui a été vu** : Personne, Véhicule, Animal, Mouvement, Son, Déclenchement externe, Autre
alerte (le plus parlant d'abord : une alerte avec une personne et du mouvement est « Personne »).
L'image de la caméra est à jour quand la scène démarre. Variables : **Nom de la caméra**, **Ce qui a
été vu**, **Étiquettes de l'IA** (le mémo de Blue Iris, ex. `person:87%`).

Seules les alertes que Blue Iris garde (pas celles que son IA a annulées) lancent une scène, un
événement par alerte. Si l'utilisateur ne peut pas lire les alertes, une alerte est quand même vue
(comme « Autre alerte ») d'après l'heure de la dernière alerte de la caméra.

## Actions de scène

- **Changer le profil Blue Iris** : par nom (`Away`) ou numéro (`1`). Un profil désarmé seulement si
  c'est permis.
- **Armer ou désarmer Blue Iris** : vert arme ; rouge désarme seulement si c'est permis.
- **Déclencher une caméra Blue Iris** : comme son bouton « Déclencher » (administrateur dans Blue
  Iris).
- **Rafraîchir l'image d'une caméra** : prend une image neuve pour Gladys, à envoyer ensuite dans un
  message.

## Exemples de scènes

- **En partant** : quand l'alarme de la maison est armée → **Changer le profil Blue Iris** sur `Away`.
- **Quelqu'un à la porte la nuit** : **Alerte sur une caméra Blue Iris**, caméra « Entrée », Ce qui a
  été vu = Personne, entre 22 h et 6 h → allumer la lumière du perron, puis envoyer l'image de la
  caméra dans un message Telegram.
- **Surveiller le portail** : un détecteur d'ouverture s'ouvre → **Déclencher une caméra Blue Iris**
  « Portail », puis orienter la caméra PTZ sur sa position mémorisée « Portail ».

## Rafraîchissement et charge

Blue Iris est un serveur local sans quota : l'intégration lit `status` et `camlist` au rythme du
**Rafraîchissement** (deux petites requêtes), et la liste des alertes seulement pour une caméra qui a
une nouvelle alerte. Deux requêtes au plus sont en cours. Les images sont demandées réduites par Blue
Iris (1280 px, puis plus petites si l'image dépasse les 150 Ko acceptés par Gladys) : rien n'est
décodé dans le conteneur. Une valeur inchangée est renvoyée toutes les 6 heures, pour que le tableau
de bord n'affiche jamais « pas de valeur récente ».

## Dépannage

- **« Blue Iris ne répond pas »** : vérifiez l'adresse, le port, que le serveur web de Blue Iris est
  actif et que le pare-feu de Windows laisse passer Gladys.
- **« Mot de passe refusé : arrêt pour que Blue Iris ne bannisse pas Gladys »** : corrigez le nom
  d'utilisateur ou le mot de passe, puis **Tester la connexion** (un essai de plus). Vérifiez dans
  Blue Iris que l'adresse de Gladys n'est pas bannie.
- **« Pas d'interface JSON Blue Iris à cette adresse »** : mauvais port, ou un autre serveur web
  répond.
- **« Cet utilisateur Blue Iris n'a pas ce droit »** : accordez le droit dans Blue Iris (changer de
  profil, PTZ, administrateur pour déclencher).
- **Désarmement refusé** : c'est voulu, voir « Armement et désarmement ».
- **Pas de fonctionnalité Personne / Véhicule** : l'IA de Blue Iris n'en a pas encore signalé ; elle
  apparaît dans Découverte (« Mettre à jour ») à la première.
- Pour le détail, réglez `LOG_LEVEL=debug` sur l'intégration : chaque alerte et chaque lecture sont
  alors journalisées.

## Limites

- Un seul serveur Blue Iris par intégration.
- Pas de flux vidéo en direct (Gladys affiche des images), pas de lecture d'enregistrements, pas de
  sorties DIO, pas de changement de planning.
- Mouvements et alertes sont vus au rythme du rafraîchissement (10 s par défaut), pas instantanément :
  Blue Iris pousse ses événements par MQTT ou appels web, que la sandbox de Gladys ne peut pas
  recevoir ici.
- Le jaune est une transition de Blue Iris (délai d'armement) : il est affiché, jamais envoyé.
- Les noms des fonctionnalités sont fixés à l'ajout d'un appareil ; les groupes de caméras ne sont
  pas des appareils.
- Développée sans le matériel : vos retours sont les bienvenus (Developed without the hardware:
  feedback welcome).
