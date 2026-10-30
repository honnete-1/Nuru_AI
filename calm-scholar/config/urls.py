from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path
from scholar import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.home, name='home'),
    path('app/', views.workspace, name='workspace'),
    path('accounts/register/', views.register, name='register'),
    path('accounts/login/', auth_views.LoginView.as_view(), name='login'),
    path('accounts/logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('accounts/demo/', views.demo, name='demo'),
    path('api/state/', views.state, name='state'),
    path('api/action/', views.action, name='action'),
    path('api/materials/upload/', views.upload_material, name='upload_material'),
    path('api/materials/<int:pk>/file/', views.material_file, name='material_file'),
    path('api/materials/<int:pk>/passages/', views.material_passages, name='material_passages'),
    path('api/passages/<int:pk>/', views.passage_view, name='passage'),
    path('api/export/', views.export_data, name='export'),
    path('health/', views.health, name='health'),
]
