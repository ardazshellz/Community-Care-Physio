# Homepage coverage map — draft, 15 September 2026

Unpublished working-tree changes: index.html and assets/coverage-{map.css,map.js,policy.js,districts.json,map-LICENSE.md}.

The existing Areas section is replaced with a responsive SVG of real approximate postcode district boundaries. Green: SW15, SW16 (new Streatham inclusion), SW17, SW18, SW19, SW20, SM4. Mouse, keyboard and touch activation open the existing booking modal with the selected area. A postcode dropdown provides an alternative to small map targets. Hero dropdown, FAQ, chat coverage and footer include Streatham.

Boundary data © Wikipedia contributors via missinglink/uk-postcode-polygons, CC BY-SA 3.0, adapted and attributed in the page and asset licence. Reference image artwork is not copied. Temporary generator and downloaded sources are in ../work/, outside the repository. No new production dependency.

Verified local desktop rendering, mobile layout, and Enter on SW16 opening the booking modal. Exact postcode parsing checks passed. No real booking, payment, patient record changes, commit, push or deployment for this feature.

PENDING USER CHOICE: User requested £15 per visit next to the green area and £40 farther out. Asked whether to use postcode districts directly bordering green, £40 other districts displayed, beyond map check first. User asked difference between postcode and borough. Explained postcode districts match the reference map and are preferable for address-based charges; awaiting their choice. DO NOT enable/publish travel charges before that choice. Current map draft uses generic "additional travel fee" for grey regions; checkout is unchanged and does not yet calculate travel fees. Subsequent work must keep frontend/Stripe server calculation identical, multiply per-visit charge for package visit count, show itemised fee before payment, handle postcode edits and outside-map addresses, and verify without real charges. Legacy chatbot still says up to £15; replace when policy agreed.

Geometric adjacency candidate list (source boundary gaps tolerated to 30m): CR4, CR7, KT2, KT3, KT4, SE19, SE27, SM1, SM3, SM5, SW11, SW12, SW13, SW14, SW2, SW6, TW10. Not yet enabled as a pricing policy.

## Revision: fixed layout and expanded included area

Added SW6 Fulham, SW7 South Kensington, SW11 Battersea and CR4 Mitcham to the included list, FAQ/chat/footer and hero selector. Removed hover/focus updates to the right-hand panel; hover now only highlights the polygon. Top-aligned grid and fixed 150px readout prevent the map from moving when the selected area changes. Browser verification showed identical map height (598.21px) and panel height before/after SW19 → SW7.

Added a Thames riverbank polygon from the GLA webmap context service, projected using the same transform as postcode polygons. This source represents the tidal Thames; it exits the western viewport near Teddington and does not include the upstream Kingston stretch. Source attributed on the map. No invented river geometry.

User now suggests included areas reachable by public transport in about 15 minutes. Asked for starting station/postcode; named additions above are done, broader travel-time inclusion awaits that answer. £15/£40 tier implementation and publication remain pending. No live payments or patient data touched.

## Confirmed travel rule

The owner confirmed a maximum 45-minute door-to-door public-transport journey, including walking, waiting and changes, using District/Northern line or Thameslink connections. This supersedes the earlier approximate 15-minute discussion. The private starting address is supplied in conversation only; do not put it in public source, assets, documentation or client requests. Exact-address routing via TfL was blocked by automatic approval review pending explicit permission to send that location to TfL. No new journey-based green districts have been asserted or published. A station-only lookup would exclude the initial walk and cannot be presented as verified door-to-door coverage.

## Borough route review and superseding fee decision

Owner confirmed: <=30 minutes door to door each way included; >30 to <=45 minutes £15 per visit; >45 minutes £35 per visit by arrangement. This supersedes all earlier £10/£25, £15/£40 and blanket 45-minute included-travel ideas. User explicitly requested Citymapper instead of TfL for the supplied origin. Citymapper route review completed for 14 representative station destinations in 12 nearby/central boroughs at Wednesday 16 September 2026 10:00 London time. Private starting address must not enter repository files or public client code. User-facing findings are in ../outputs/BOROUGH-TRAVEL-BANDS.md. Station examples omit the patient's final walk and are not sufficient to assign entire boroughs/postcode districts a guaranteed price. Current map colours still reflect the earlier named-area inclusions; pricing backend remains unchanged. Reconcile before publication.

## Renewed preview — final 40/50-minute bands

Confirmed latest fee rules: <=40 minutes included; >40–50 minutes £15 per visit; >50 minutes £35 per visit by arrangement. Added tested travelBand(minutes) pure helper for exact boundaries. This is display-only; checkout is unchanged.

The map now uses green/amber/grey for representative Citymapper station-sample bands, and hatching for unchecked districts. It explicitly states that full-address travel may change the fee. Previous named-area inclusion alone is no longer treated as journey evidence: unchecked districts are hatched rather than assigned an invented time. The legacy INCLUDED_DISTRICTS export and older FAQ/chat statements still need reconciliation before any production release; do not deploy this preview as finished pricing enforcement.

Verified latest preview legend and map rendering. Fixed readout height and no hover-text changes retained. Thames retained. No home address or origin coordinates are stored in map assets. Current request is to view the renewed map; no production publication performed.

## Latest owner-selected zones — 15 September 2026

Supersedes the station-sample colours and hatching above. The owner requested a simple fixed postcode map for review. Green: SW1 subdivisions and SW2–SW20, SM4, CR4, KT2, KT3, TW9 and TW10. Yellow (£15 per visit): SE11, SE5, SE24, SE27, SE19, CR7, SM6, SM5, SM1, SM3, KT4, KT5, TW11, TW1. Other displayed districts are grey (£35 per visit by arrangement), including TW7, TW8, W4 and CR0. Richmond, SW2, SW9 and SW10 follow the owner's final correction to included.

Removed journey sample readouts and hatching; retained River Thames, fixed readout height and hover-only boundary highlighting. Verified all 81 displayed districts have one of the three bands and checked dropdown outputs for SE11, TW7 and TW9 in the local preview. This remains a local map preview; Stripe checkout travel-fee collection has not been changed or deployed.

Owner follow-up: also colour KT1, W6, W14, W8, W2, W4, SE1, SE17 and SE21 yellow (£15 per visit), to make the surrounding band more continuous. This supersedes their previous grey classification.

## Postcode checker and checkout integration

Added a local postcode/district checker and an SVG pin at the district label point. The pin is explicitly approximate and does not geocode a home address or call a third-party location service. Map selection carries the district or entered full postcode into both new and returning patient forms. The visit postcode can be changed; travel and totals recalculate. Full address remains part of the normal details form, with no insecure saved-address lookup.

Shared coverage policy now limits checkout to the 81 displayed districts. Outside-map entries require contact. Checkout validates a full postcode and known appointment type, ignores submitted prices/fees, and computes travel server-side. Package travel is charged for all four or six visits and appears as a separate Stripe line item; the total is saved in booking price and the travel breakdown in Stripe metadata. These changes are implemented locally, not deployed. Enquiry-generated payment links are a separate flow and are unchanged.

Validation: 29 automated tests pass, including four coverage/pricing tests. Browser preview checked new and returning patient routes, W4 £75+£15=£90 through simulated checkout, CR0 six-visit programme £435+£210=£645, switching to SW15 removes the fee, and outside-map entry disables the map booking action. No live payment was made.

## 16 September 2026 — simplified map controls
Removed the postcode-district dropdown and its JavaScript/CSS dependencies. Visitors use the postcode checker or clickable map. Updated instructions and map-loading fallback. Verified JavaScript syntax, no dropdown after browser refresh, and KT1 lookup returning £15 with a map pin.
