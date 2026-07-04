import type { FormEvent } from "react";
import type { DaggerheartDetailsPage, DaggerheartTexts } from "../types";
import { normalizeDetailsPage } from "../utils/detailsPage";
import { Field, TextAreaField } from "./Field";
import { SectionCard } from "./SectionCard";

type DaggerheartDetailsTabProps = {
  value: DaggerheartDetailsPage;
  t: DaggerheartTexts;
  onChange: (next: DaggerheartDetailsPage) => void;
};

type PhysicalField = keyof DaggerheartDetailsPage["physical"];
type AncestryField = keyof DaggerheartDetailsPage["abilities"]["ancestry"];
type FoundationField = keyof DaggerheartDetailsPage["abilities"]["foundation"];

export function DaggerheartDetailsTab({
  value,
  t,
  onChange,
}: DaggerheartDetailsTabProps) {
  const details = normalizeDetailsPage(value);

  function updatePhysical(field: PhysicalField, nextValue: string) {
    onChange({
      ...details,
      physical: {
        ...details.physical,
        [field]: nextValue,
      },
    });
  }

  function updateDomainCards(nextValue: string) {
    onChange({
      ...details,
      domainCards: nextValue,
    });
  }

  function updateAncestry(field: AncestryField, nextValue: string) {
    onChange({
      ...details,
      abilities: {
        ...details.abilities,
        ancestry: {
          ...details.abilities.ancestry,
          [field]: nextValue,
        },
      },
    });
  }

  function updateAbility(
    field: "community" | "specialization" | "mastery",
    nextValue: string,
  ) {
    onChange({
      ...details,
      abilities: {
        ...details.abilities,
        [field]: nextValue,
      },
    });
  }

  function updateFoundation(field: FoundationField, nextValue: string) {
    onChange({
      ...details,
      abilities: {
        ...details.abilities,
        foundation: {
          ...details.abilities.foundation,
          [field]: nextValue,
        },
      },
    });
  }

  function updateStory(nextValue: string) {
    onChange({
      ...details,
      story: nextValue,
    });
  }

  function stopParentFormSerialization(event: FormEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  return (
    <div
      className="dh-details-tab dh-stack"
      onInput={stopParentFormSerialization}
      onChange={stopParentFormSerialization}
    >
      <SectionCard title={t.details.physicalDetails}>
        <div className="dh-details-physical-grid">
          <Field
            id="details-age"
            name="detailsPage.physical.age"
            label={t.details.age}
            value={details.physical.age}
            onChange={(event) => updatePhysical("age", event.currentTarget.value)}
          />
          <Field
            id="details-height"
            name="detailsPage.physical.height"
            label={t.details.height}
            value={details.physical.height}
            onChange={(event) => updatePhysical("height", event.currentTarget.value)}
          />
          <Field
            id="details-weight"
            name="detailsPage.physical.weight"
            label={t.details.weight}
            value={details.physical.weight}
            onChange={(event) => updatePhysical("weight", event.currentTarget.value)}
          />
          <Field
            id="details-other"
            name="detailsPage.physical.other"
            label={t.details.other}
            value={details.physical.other}
            onChange={(event) => updatePhysical("other", event.currentTarget.value)}
          />
          <Field
            id="details-eyes"
            name="detailsPage.physical.eyes"
            label={t.details.eyes}
            value={details.physical.eyes}
            onChange={(event) => updatePhysical("eyes", event.currentTarget.value)}
          />
          <Field
            id="details-body"
            name="detailsPage.physical.body"
            label={t.details.body}
            value={details.physical.body}
            onChange={(event) => updatePhysical("body", event.currentTarget.value)}
          />
          <Field
            id="details-hair"
            name="detailsPage.physical.hair"
            label={t.details.hair}
            value={details.physical.hair}
            onChange={(event) => updatePhysical("hair", event.currentTarget.value)}
          />
        </div>
      </SectionCard>

      <div className="dh-details-main-grid">
        <SectionCard title={t.details.domainCards}>
          <TextAreaField
            id="details-domain-cards"
            name="detailsPage.domainCards"
            label={t.details.domainCards}
            className="dh-details-tall-textarea"
            placeholder={t.details.domainCardsPlaceholder}
            value={details.domainCards}
            onChange={(event) => updateDomainCards(event.currentTarget.value)}
          />
        </SectionCard>

        <SectionCard title={t.details.abilities}>
          <div className="dh-stack">
            <div className="dh-details-subsection">
              <h3>{t.details.ancestryAbilities}</h3>
              <div className="dh-field-row">
                <TextAreaField
                  id="details-ancestry-first"
                  name="detailsPage.abilities.ancestry.first"
                  className="dh-details-medium-textarea"
                  label={t.details.ancestryFirst}
                  placeholder={t.details.abilityPlaceholder}
                  value={details.abilities.ancestry.first}
                  onChange={(event) =>
                    updateAncestry("first", event.currentTarget.value)
                  }
                />
                <TextAreaField
                  id="details-ancestry-second"
                  name="detailsPage.abilities.ancestry.second"
                  className="dh-details-medium-textarea"
                  label={t.details.ancestrySecond}
                  placeholder={t.details.abilityPlaceholder}
                  value={details.abilities.ancestry.second}
                  onChange={(event) =>
                    updateAncestry("second", event.currentTarget.value)
                  }
                />
              </div>
            </div>

            <TextAreaField
              id="details-community"
              name="detailsPage.abilities.community"
              label={t.details.communityAbility}
              placeholder={t.details.abilityPlaceholder}
              value={details.abilities.community}
              onChange={(event) =>
                updateAbility("community", event.currentTarget.value)
              }
            />

            <div className="dh-details-subsection">
              <h3>{t.details.foundationAbility}</h3>
              <div className="dh-details-foundation-grid">
                <Field
                  id="details-foundation-casting-attribute"
                  name="detailsPage.abilities.foundation.castingAttribute"
                  label={t.details.castingAttribute}
                  value={details.abilities.foundation.castingAttribute}
                  onChange={(event) =>
                    updateFoundation("castingAttribute", event.currentTarget.value)
                  }
                />
                <TextAreaField
                  id="details-foundation-text"
                  name="detailsPage.abilities.foundation.text"
                  label={t.details.foundationDescription}
                  placeholder={t.details.abilityPlaceholder}
                  value={details.abilities.foundation.text}
                  onChange={(event) =>
                    updateFoundation("text", event.currentTarget.value)
                  }
                />
              </div>
            </div>

            <TextAreaField
              id="details-specialization"
              name="detailsPage.abilities.specialization"
              label={t.details.specializationAbility}
              className="dh-details-medium-textarea"
              placeholder={t.details.abilityPlaceholder}
              value={details.abilities.specialization}
              onChange={(event) =>
                updateAbility("specialization", event.currentTarget.value)
              }
            />

            <TextAreaField
              id="details-mastery"
              name="detailsPage.abilities.mastery"
              label={t.details.masteryAbility}
              className="dh-details-medium-textarea"
              placeholder={t.details.abilityPlaceholder}
              value={details.abilities.mastery}
              onChange={(event) => updateAbility("mastery", event.currentTarget.value)}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={t.details.characterStory}>
        <TextAreaField
          id="details-story"
          name="detailsPage.story"
          label={t.details.characterStory}
          className="dh-details-story-textarea"
          placeholder={t.details.characterStoryPlaceholder}
          value={details.story}
          onChange={(event) => updateStory(event.currentTarget.value)}
        />
      </SectionCard>
    </div>
  );
}
