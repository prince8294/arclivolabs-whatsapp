import { TemplateEditor } from "@/components/templates/template-editor";

export default function EditTemplatePage({ params }: { params: { id: string } }) {
  return <TemplateEditor templateId={params.id} />;
}
