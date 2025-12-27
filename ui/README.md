# Dashboard prêteur privé

But : un dashboard simple (1 page client) qui sépare clairement :
- Contrat (calcul normal)
- Souffrance (NSF / report / pénalités)
- Prélèvements (exécution bancaire)

## Règles
1) Le contrat ne change jamais lors d’un NSF
2) La souffrance est une couche séparée
3) Chaque action = 1 bouton + 1 aperçu + 1 confirmation

## Actions rapides
- Reporter un paiement (choisir une date)
- Ajouter NSF (montant + frais)
- Répartir souffrance sur X paiements
- Paiement manuel / virement

## Interface (1 écran)
- Bandeau résumé (solde contrat, souffrance, prochain prélèvement)
- Calendrier des paiements (table)
- Panneau actions (icônes)
- Notes & historique
